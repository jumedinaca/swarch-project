import asyncio
import contextlib
import json
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from functools import partial
from typing import TYPE_CHECKING

from aio_pika import DeliveryMode, ExchangeType, Message
from aio_pika.abc import AbstractExchange, AbstractIncomingMessage

from app.core.logging import get_logger, sanitize_error

from .connection import RabbitMQConnection
from .events import EmailDeliveryJob, InvalidEventError, parse_incoming_event
from .publisher import EmailEventPublisher

if TYPE_CHECKING:
    from app.service.email_service import DeliveryResult, EmailService

logger = get_logger(__name__)

# eventType -> (nombre de cola según README_P2, sufijo corto para ruteo de reintento)
QUEUES: dict[str, tuple[str, str]] = {
    "user.registered.v1": ("email.user.registered.q", "registered"),
    "email.requested.v1": ("email.send.q", "send"),
}

DLX_EXCHANGE_NAME = "geopicto.email.dlx"
RETRY_EXCHANGE_NAME = "geopicto.email.retry"
DLQ_QUEUE_NAME = "email.dlq"

PREFETCH_COUNT = 10
BROKER_RECONNECT_SECONDS = 5
DB_OUTAGE_DELAY_SECONDS = 1

ServiceScope = Callable[[], AbstractAsyncContextManager["EmailService"]]


@dataclass(frozen=True)
class DlqRecord:
    email_id: str
    idempotency_key: str
    template: str
    status: str
    reason: str | None


class LocalEmailWorker:
    """
    Worker asíncrono en memoria con soporte no bloqueante de backoff y DLQ.
    Se usa cuando `RABBITMQ_URL` no está definido o como respaldo local.
    """

    def __init__(self, service_scope: ServiceScope):
        self.service_scope = service_scope
        self._queue: asyncio.Queue[tuple[EmailDeliveryJob, int]] = asyncio.Queue()
        self._scheduled_tasks: set[asyncio.Task[None]] = set()
        self._active_count = 0
        self._idle_event = asyncio.Event()
        self._idle_event.set()
        self.dlq_messages: list[DlqRecord] = []

    def _refresh_idle(self) -> None:
        if self._queue.empty() and self._active_count == 0 and not self._scheduled_tasks:
            self._idle_event.set()
        else:
            self._idle_event.clear()

    async def enqueue(self, job: EmailDeliveryJob, retry_count: int = 0) -> None:
        self._idle_event.clear()
        await self._queue.put((job, retry_count))

    async def wait_idle(self, timeout: float = 5.0) -> None:
        await asyncio.wait_for(self._idle_event.wait(), timeout=timeout)

    def _schedule_delayed(self, job: EmailDeliveryJob, retry_count: int, delay_seconds: float) -> None:
        async def _later() -> None:
            try:
                await asyncio.sleep(max(0.0, delay_seconds))
                await self._queue.put((job, retry_count))
            except asyncio.CancelledError:
                raise
            finally:
                task = asyncio.current_task()
                if task is not None:
                    self._scheduled_tasks.discard(task)
                self._refresh_idle()

        task = asyncio.create_task(_later())
        self._scheduled_tasks.add(task)
        self._refresh_idle()

    async def run_forever(self) -> None:
        try:
            while True:
                job, retry_count = await self._queue.get()
                self._active_count += 1
                self._refresh_idle()
                try:
                    async with self.service_scope() as service:
                        result: DeliveryResult = await service.process_job(job, retry_count=retry_count)
                    if result.action == "retry":
                        self._schedule_delayed(job, result.next_retry_count, result.wait_seconds)
                    elif result.action == "defer_global_limit":
                        self._schedule_delayed(job, retry_count, result.wait_seconds)
                    elif result.action in ("dlq", "failed_permanent"):
                        self.dlq_messages.append(
                            DlqRecord(
                                email_id=str(result.email_id),
                                idempotency_key=job.idempotency_key,
                                template=job.template,
                                status=result.status,
                                reason=result.error,
                            )
                        )
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.error(
                        "email.local_worker_unexpected_error",
                        email_id=str(job.email_id),
                        error=sanitize_error(exc, recipient=job.to),
                    )
                finally:
                    self._active_count -= 1
                    self._queue.task_done()
                    self._refresh_idle()
        finally:
            for t in list(self._scheduled_tasks):
                t.cancel()
            for t in list(self._scheduled_tasks):
                with contextlib.suppress(asyncio.CancelledError):
                    await t
            self._scheduled_tasks.clear()


class EmailJobDispatcher:
    """
    Despachador unificado para `POST /internal/emails`:
    - Si RabbitMQ está configurado y disponible, publica `email.requested.v1` a `geopicto.events`.
    - En caso contrario (o si el broker cae momentáneamente), delega al `LocalEmailWorker`.
    """

    def __init__(self, publisher: EmailEventPublisher | None, local_worker: LocalEmailWorker):
        self.publisher = publisher
        self.local_worker = local_worker

    async def dispatch_requested(self, job: EmailDeliveryJob) -> None:
        from app.service.email_service import job_to_requested_event

        if self.publisher is not None:
            try:
                await self.publisher.publish(job_to_requested_event(job))
                return
            except Exception as exc:
                logger.warning(
                    "email.broker_unavailable_fallback_local",
                    email_id=str(job.email_id),
                    error=sanitize_error(exc, recipient=job.to),
                )
        await self.local_worker.enqueue(job, retry_count=0)


class EmailEventConsumer:
    """
    Consume `email.user.registered.q` y `email.send.q` desde RabbitMQ,
    declarando colas de espera por TTL (`10 s`, `1 min`, `5 min`) y `email.dlq`
    para reintentar sin bloquear la cola principal.
    """

    def __init__(
        self,
        connection: RabbitMQConnection,
        exchange_name: str,
        retry_delays_seconds: list[float],
        service_scope: ServiceScope,
    ):
        self.connection = connection
        self.exchange_name = exchange_name
        self.retry_delays_seconds = retry_delays_seconds
        self.service_scope = service_scope
        self._dlx_exchange: AbstractExchange | None = None

    async def run_forever(self) -> None:
        while True:
            try:
                await self.start()
                logger.info("email.consumer_started", exchange=self.exchange_name)
                return
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning(
                    "email.rabbitmq_connect_retry",
                    retry_in_seconds=BROKER_RECONNECT_SECONDS,
                    error=sanitize_error(exc),
                )
                await asyncio.sleep(BROKER_RECONNECT_SECONDS)

    @staticmethod
    def _retry_queue_name(idx: int, delay_seconds: float) -> str:
        if delay_seconds.is_integer():
            return f"email.retry.{int(delay_seconds)}s.q"
        return f"email.retry.step{idx}.q"

    async def start(self) -> None:
        await self.connection.connect()
        channel = self.connection.channel
        await channel.set_qos(prefetch_count=PREFETCH_COUNT)

        events_exchange = await channel.declare_exchange(
            self.exchange_name,
            type=ExchangeType.TOPIC,
            durable=True,
        )
        dlx_exchange = await channel.declare_exchange(
            DLX_EXCHANGE_NAME,
            type=ExchangeType.TOPIC,
            durable=True,
        )
        retry_exchange = await channel.declare_exchange(
            RETRY_EXCHANGE_NAME,
            type=ExchangeType.TOPIC,
            durable=True,
        )
        self._dlx_exchange = dlx_exchange

        # Cola final de fallos definitivos (DLQ).
        dlq = await channel.declare_queue(DLQ_QUEUE_NAME, durable=True)
        await dlq.bind(dlx_exchange, routing_key="dlq.#")

        # Colas de espera por TTL para reintentos sin bloqueo de cabecera de cola.
        for idx, delay_s in enumerate(self.retry_delays_seconds, start=1):
            ttl_ms = max(1, int(round(delay_s * 1000)))
            retry_q = await channel.declare_queue(
                self._retry_queue_name(idx, delay_s),
                durable=True,
                arguments={
                    "x-message-ttl": ttl_ms,
                    "x-dead-letter-exchange": RETRY_EXCHANGE_NAME,
                },
            )
            await retry_q.bind(dlx_exchange, routing_key=f"retry.{idx}.#")

        # Colas principales consumidas por el servicio.
        for event_type, (queue_name, queue_tag) in QUEUES.items():
            queue = await channel.declare_queue(
                queue_name,
                durable=True,
                arguments={
                    "x-dead-letter-exchange": DLX_EXCHANGE_NAME,
                    "x-dead-letter-routing-key": "dlq.rejected",
                },
            )
            await queue.bind(events_exchange, routing_key=event_type)
            await queue.bind(retry_exchange, routing_key=f"retry.*.{queue_tag}")
            await queue.consume(partial(self._on_message, event_type, queue_tag))

    async def _publish_to_dlx(self, routing_key: str, body: bytes, headers: dict[str, object]) -> None:
        assert self._dlx_exchange is not None
        msg = Message(
            body=body,
            content_type="application/json",
            delivery_mode=DeliveryMode.PERSISTENT,
            headers=headers,
        )
        await self._dlx_exchange.publish(msg, routing_key=routing_key)

    async def _on_message(self, event_type: str, queue_tag: str, message: AbstractIncomingMessage) -> None:
        raw_headers = dict(message.headers or {})
        try:
            retry_count = int(raw_headers.get("x-retry-count", 0))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            retry_count = 0

        try:
            envelope = json.loads(message.body)
            if not isinstance(envelope, dict):
                raise InvalidEventError("El cuerpo del evento debe ser un objeto JSON.")
            job = parse_incoming_event(event_type, envelope)
        except (json.JSONDecodeError, UnicodeDecodeError, InvalidEventError) as exc:
            logger.error(
                "email.invalid_event_rejected",
                event_type=event_type,
                message_id=message.message_id,
                error=sanitize_error(exc),
            )
            # No reintentar un evento/correo inválido: va directo a email.dlq por DLX.
            await message.reject(requeue=False)
            return

        try:
            async with self.service_scope() as service:
                result = await service.process_job(job, retry_count=retry_count)
        except Exception as exc:
            logger.error(
                "email.consumer_db_or_infra_error",
                event_type=event_type,
                email_id=str(job.email_id),
                error=sanitize_error(exc, recipient=job.to),
            )
            await asyncio.sleep(DB_OUTAGE_DELAY_SECONDS)
            await message.nack(requeue=True)
            return

        if result.action in ("sent", "duplicate"):
            await message.ack()
            return

        if result.action == "retry":
            await self._publish_to_dlx(
                routing_key=f"retry.{result.next_retry_count}.{queue_tag}",
                body=message.body,
                headers={
                    **raw_headers,
                    "x-retry-count": result.next_retry_count,
                    "x-email-id": str(result.email_id),
                    "x-last-error": result.error or "",
                },
            )
            await message.ack()
            return

        if result.action == "defer_global_limit":
            await self._publish_to_dlx(
                routing_key=f"retry.1.{queue_tag}",
                body=message.body,
                headers={
                    **raw_headers,
                    "x-retry-count": retry_count,
                    "x-email-id": str(result.email_id),
                    "x-deferred": "global_rate_limit",
                },
            )
            await message.ack()
            return

        # Fallo definitivo (agotó reintentos -> DLQ, o fallo permanente sin reintentos).
        await self._publish_to_dlx(
            routing_key="dlq.failed",
            body=message.body,
            headers={
                **raw_headers,
                "x-retry-count": retry_count,
                "x-email-id": str(result.email_id),
                "x-terminal-status": result.status,
                "x-last-error": result.error or "",
            },
        )
        await message.ack()
