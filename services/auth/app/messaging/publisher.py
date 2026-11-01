from aio_pika import DeliveryMode, ExchangeType, Message
from aio_pika.abc import AbstractExchange

from .connection import RabbitMQConnection
from .events import UserRegisteredEvent


class UserEventPublisher:
    def __init__(self, connection: RabbitMQConnection, exchange_name: str = "geopicto.events"):
        self.connection = connection
        self.exchange_name = exchange_name
        self._exchange: AbstractExchange | None = None

    async def initialize(self) -> None:
        await self.connection.connect()
        self._exchange = await self.connection.channel.declare_exchange(
            self.exchange_name,
            type=ExchangeType.TOPIC,
            durable=True,
        )

    async def publish(self, event: UserRegisteredEvent) -> None:
        if self._exchange is None:
            # Primer intento tras un arranque sin broker: reintenta conectar.
            await self.initialize()

        message = Message(
            body=event.model_dump_json(by_alias=True).encode("utf-8"),
            content_type="application/json",
            delivery_mode=DeliveryMode.PERSISTENT,
            message_id=str(event.event_id),
            type=event.event_type,
            headers={
                "x-event-id": str(event.event_id),
                "x-event-type": event.event_type,
                "x-correlation-id": str(event.correlation_id),
            },
        )

        # La routing key es el eventType ("user.registered.v1"), igual que las
        # bindings de profile.user.registered.q y email.user.registered.q.
        await self._exchange.publish(message, routing_key=event.event_type)
