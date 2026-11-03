import asyncio
import json
import logging
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from typing import TYPE_CHECKING

from aio_pika import ExchangeType
from aio_pika.abc import AbstractIncomingMessage
from pydantic import ValidationError

from .connection import RabbitMQConnection
from .events import IncomingEvent, ModerationFailedEvent, ModerationFailedPayload

if TYPE_CHECKING:
    from app.messaging.publisher import ModerationEventPublisher
    from app.service.moderation_service import ModerationService

logger = logging.getLogger(__name__)

# eventType (routing key) -> cola propia de moderation
QUEUES = {
    "message.submitted.v1": "moderation.message.submitted.q",
    "message.edited.v1": "moderation.message.edited.q",
}

# Los eventos que fallan todos los reintentos (o no se pueden leer) terminan en
# esta cola para revisarlos y republicarlos a mano.
DEAD_LETTER_EXCHANGE = "moderation.dlx"
DEAD_LETTER_QUEUE = "moderation.dlq"

PREFETCH_COUNT = 10
RETRY_SECONDS = 5

ServiceScope = Callable[[], AbstractAsyncContextManager["ModerationService"]]


class InvalidEventError(Exception):
    pass


def parse_event(body: bytes) -> IncomingEvent:
    try:
        return IncomingEvent.model_validate(json.loads(body))
    except (ValueError, TypeError, ValidationError) as exc:
        raise InvalidEventError(str(exc)) from exc


class MessageEventConsumer:
    """
    Consume los mensajes nuevos o editados de messages y publica la decisión.
    La moderación es idempotente por (messageId, messageVersion).
    """

    def __init__(
        self,
        connection: RabbitMQConnection | None,
        exchange_name: str,
        service_scope: ServiceScope,
        publisher: "ModerationEventPublisher | None",
        *,
        max_attempts: int = 3,
        retry_base_seconds: float = 0.5,
    ):
        self.connection = connection
        self.exchange_name = exchange_name
        self.service_scope = service_scope
        self.publisher = publisher
        self.max_attempts = max_attempts
        self.retry_base_seconds = retry_base_seconds
        self.ready = False

    async def run_forever(self) -> None:
        """Reintenta hasta que el broker responda; luego aio-pika reconecta solo."""
        while True:
            try:
                await self.start()
                self.ready = True
                logger.info("Consumiendo mensajes desde %s.", self.exchange_name)
                return
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning(
                    "RabbitMQ no disponible; se reintenta en %s s.", RETRY_SECONDS, exc_info=True
                )
                await asyncio.sleep(RETRY_SECONDS)

    async def start(self) -> None:
        await self.connection.connect()
        channel = self.connection.channel
        await channel.set_qos(prefetch_count=PREFETCH_COUNT)
        exchange = await channel.declare_exchange(self.exchange_name, type=ExchangeType.TOPIC, durable=True)

        dlx = await channel.declare_exchange(DEAD_LETTER_EXCHANGE, type=ExchangeType.FANOUT, durable=True)
        dlq = await channel.declare_queue(DEAD_LETTER_QUEUE, durable=True)
        await dlq.bind(dlx)

        for event_type, queue_name in QUEUES.items():
            queue = await channel.declare_queue(
                queue_name, durable=True, arguments={"x-dead-letter-exchange": DEAD_LETTER_EXCHANGE}
            )
            await queue.bind(exchange, routing_key=event_type)
            await queue.consume(self._on_message)

    async def _on_message(self, message: AbstractIncomingMessage) -> None:
        if await self.process(message.body):
            await message.ack()
        else:
            # A la DLQ: ya se reintentó o el evento no se puede leer.
            await message.reject(requeue=False)

    async def process(self, body: bytes) -> bool:
        """Modera un evento con reintentos. Devuelve False si debe ir a la DLQ."""
        try:
            event = parse_event(body)
        except InvalidEventError:
            logger.error("Evento descartado por formato inválido.")
            return False

        from app.service.moderation_service import ModerationRequest

        payload = event.payload
        request = ModerationRequest(
            message_id=payload.message_id,
            author_id=payload.author_id,
            content=payload.content,
            message_version=payload.message_version,
        )

        last_error = "unknown"
        for attempt in range(1, self.max_attempts + 1):
            try:
                async with self.service_scope() as service:
                    await service.moderate(
                        request, correlation_id=event.correlation_id, causation_id=event.event_id
                    )
                return True
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                last_error = type(exc).__name__
                logger.warning(
                    "Intento %s/%s fallido para messageId=%s (%s).",
                    attempt,
                    self.max_attempts,
                    payload.message_id,
                    last_error,
                )
                if attempt < self.max_attempts:
                    await asyncio.sleep(self.retry_base_seconds * 2 ** (attempt - 1))

        await self._publish_failed(event, last_error)
        return False

    async def _publish_failed(self, event: IncomingEvent, reason: str) -> None:
        if self.publisher is None:
            return
        failed = ModerationFailedEvent(
            correlation_id=event.correlation_id or event.event_id,
            causation_id=event.event_id,
            payload=ModerationFailedPayload(
                message_id=event.payload.message_id,
                author_id=event.payload.author_id,
                message_version=event.payload.message_version,
                reason=f"MODERATION_ERROR:{reason}",
            ),
        )
        try:
            await self.publisher.publish(failed)
        except Exception:
            # messages igual aplica su política al vencer MODERATION_TIMEOUT_SECONDS.
            logger.exception("No se pudo publicar moderation.failed.v1 (messageId=%s).", event.payload.message_id)
