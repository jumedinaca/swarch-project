import aio_pika
from aio_pika.abc import AbstractRobustChannel, AbstractRobustConnection

CONNECT_TIMEOUT_SECONDS = 5


class RabbitMQConnection:
    def __init__(self, url: str):
        self.url = url
        self._connection: AbstractRobustConnection | None = None
        self._channel: AbstractRobustChannel | None = None

    async def connect(self) -> None:
        """Conecta de forma idempotente. Se puede reintentar tras un fallo."""
        if self._connection is None or self._connection.is_closed:
            self._connection = await aio_pika.connect_robust(
                self.url, timeout=CONNECT_TIMEOUT_SECONDS
            )
        if self._channel is None or self._channel.is_closed:
            self._channel = await self._connection.channel()

    async def close(self) -> None:
        if self._connection and not self._connection.is_closed:
            await self._connection.close()

    @property
    def channel(self) -> AbstractRobustChannel:
        if self._channel is None or self._channel.is_closed:
            raise RuntimeError("RabbitMQ connection is not initialized")
        return self._channel
