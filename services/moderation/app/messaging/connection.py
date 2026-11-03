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
        # El consumidor y el publicador comparten la conexión y pueden pedirla a la vez.
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        """Conecta de forma idempotente. Se puede reintentar tras un fallo."""
        async with self._lock:
            await self._connect()

    async def _connect(self) -> None:
        if self._connection is None or self._connection.is_closed:
            # Equivale a aio_pika.connect_robust, pero conserva la referencia:
            # si el primer intento falla o se cancela (al apagar el servicio),
            # hay que cerrarla o su bucle de reconexión queda vivo para siempre.
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
    def channel(self) -> AbstractRobustChannel:
        if self._channel is None or self._channel.is_closed:
            raise RuntimeError("RabbitMQ connection is not initialized")
        return self._channel
