import asyncio
import json
import logging
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from functools import partial
from typing import TYPE_CHECKING

from aio_pika import ExchangeType
from aio_pika.abc import AbstractIncomingMessage
from pydantic import ValidationError

from .connection import RabbitMQConnection
from .events import UserDeletedPayload, UserRegisteredPayload, UserUpdatedPayload

if TYPE_CHECKING:
    from app.service.profile_service import ProfileService

logger = logging.getLogger(__name__)

# eventType (routing key) -> cola propia de profile
QUEUES = {
    "user.registered.v1": "profile.user.registered.q",
    "user.updated.v1": "profile.user.updated.q",
    "user.deleted.v1": "profile.user.deleted.q",
}

PREFETCH_COUNT = 10
RETRY_SECONDS = 5
REQUEUE_DELAY_SECONDS = 1

ServiceScope = Callable[[], AbstractAsyncContextManager["ProfileService"]]


class InvalidEventError(Exception):
    pass


class UserEventConsumer:
    """
    Consume los eventos de identidad de auth. Los manejadores son idempotentes
    por clave natural (user_id), así que una entrega repetida no tiene efecto.
    """

    def __init__(self, connection: RabbitMQConnection | None, exchange_name: str, service_scope: ServiceScope):
        self.connection = connection
        self.exchange_name = exchange_name
        self.service_scope = service_scope

    async def run_forever(self) -> None:
        """Reintenta hasta que el broker responda; luego aio-pika reconecta solo."""
        while True:
            try:
                await self.start()
                logger.info("Consumiendo eventos de usuario desde %s.", self.exchange_name)
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
        for event_type, queue_name in QUEUES.items():
            queue = await channel.declare_queue(queue_name, durable=True)
            await queue.bind(exchange, routing_key=event_type)
            await queue.consume(partial(self._on_message, event_type))

    async def _on_message(self, event_type: str, message: AbstractIncomingMessage) -> None:
        try:
            await self.dispatch(event_type, message.body)
        except InvalidEventError:
            # Mensaje imposible de procesar: reintentarlo no lo arregla.
            logger.error("Evento %s descartado por formato inválido (messageId=%s).", event_type, message.message_id)
            await message.reject(requeue=False)
            return
        except Exception:
            logger.exception("Error procesando %s (messageId=%s); se reencola.", event_type, message.message_id)
            # Pausa corta para no girar en caliente si la BD está caída.
            await asyncio.sleep(REQUEUE_DELAY_SECONDS)
            await message.nack(requeue=True)
            return
        await message.ack()

    async def dispatch(self, event_type: str, body: bytes) -> None:
        try:
            raw = json.loads(body)["payload"]
            if event_type == "user.registered.v1":
                payload = UserRegisteredPayload.model_validate(raw)
            elif event_type == "user.updated.v1":
                payload = UserUpdatedPayload.model_validate(raw)
            elif event_type == "user.deleted.v1":
                payload = UserDeletedPayload.model_validate(raw)
            else:
                raise InvalidEventError(f"Evento no soportado: {event_type}")
        except (ValueError, KeyError, TypeError, ValidationError) as exc:
            raise InvalidEventError(str(exc)) from exc

        async with self.service_scope() as service:
            if isinstance(payload, UserRegisteredPayload):
                await service.on_user_registered(payload.user_id, payload.username)
            elif isinstance(payload, UserUpdatedPayload):
                await service.on_user_updated(payload.user_id, payload.username)
            else:
                await service.on_user_deleted(payload.user_id)
