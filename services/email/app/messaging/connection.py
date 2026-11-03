import asyncio

import aio_pika
from aio_pika.abc import AbstractRobustChannel, AbstractRobustConnection
from aio_pika.connection import make_url

CONNECT_TIMEOUT_SECONDS = 5


class RabbitMQConnection:
    def __init__(self, url: str):
        self.url = url
        self._connection: AbstractRobustConnection | None = None
        self._channel: AbstractRobustChannel | None = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        """Conecta de forma idempotente y segura ante concurrencia."""
        async with self._lock:
            await self._connect()

    async def _connect(self) -> None:
        if self._connection is None or self._connection.is_closed:
            connection = aio_pika.RobustConnection(make_url(self.url))
            try:
                await connection.connect(timeout=CONNECT_TIMEOUT_SECONDS)
            except BaseException:
                await connection.close()
                raise
            self._connection = connection
        if self._channel is None or self._channel.is_closed:
            self._channel = await self._connection.channel()

    async def close(self) -> None:
        if self._connection and not self._connection.is_closed:
            await self._connection.close()

    @property
    def is_connected(self) -> bool:
        return (
            self._connection is not None
            and not self._connection.is_closed
            and self._channel is not None
            and not self._channel.is_closed
        )

    @property
    def channel(self) -> AbstractRobustChannel:
        if self._channel is None or self._channel.is_closed:
            raise RuntimeError("RabbitMQ connection is not initialized")
        return self._channel
