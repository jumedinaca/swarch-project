"""Blacklist distribuida de sesiones revocadas (Escenario 5).

El access token JWT es autocontenido: el gateway puede validarlo sin consultar
la base de datos. Eso hacía que, tras un logout, el token siguiera sirviendo
hasta su expiración (15 minutos). Para cerrar esa ventana, auth registra el
``sid`` de la sesión revocada en Redis con un TTL igual al tiempo de vida que le
queda al access token. El gateway consulta esa clave antes de reenviar cada
petición protegida.

La clave es ``auth:revoked:sid:<sid>`` (el prefijo es configurable) y se guarda
en la misma base de Redis que usa el gateway (por defecto la 1, para no mezclar
con socket-gateway, que usa la 0).
"""

import logging
import uuid

from redis.asyncio import Redis

from app.core.config import Settings

logger = logging.getLogger(__name__)


class TokenBlacklist:
    """Escribe en Redis los identificadores de sesión revocados.

    Si ``TOKEN_BLACKLIST_ENABLED=false`` o no hay ``REDIS_URL``, todas las
    operaciones son no-op: el servicio sigue funcionando y el logout solo
    revoca la sesión en PostgreSQL. Ese es el modo que permite demostrar la
    vulnerabilidad de reutilización de tokens.
    """

    def __init__(self, settings: Settings):
        self.prefix = settings.token_blacklist_prefix
        self._redis: Redis | None = None

        if not settings.token_blacklist_enabled:
            logger.info(
                "Token blacklist deshabilitada (TOKEN_BLACKLIST_ENABLED=false): "
                "el gateway no podrá revocar access tokens de inmediato."
            )
            return

        if not settings.redis_url:
            logger.warning(
                "Token blacklist habilitada pero REDIS_URL está vacío; "
                "se deshabilita la revocación distribuida."
            )
            return

        self._redis = Redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=settings.redis_timeout_seconds,
            socket_timeout=settings.redis_timeout_seconds,
        )

    @property
    def enabled(self) -> bool:
        return self._redis is not None

    async def revoke_session(self, session_id: uuid.UUID, ttl_seconds: int) -> None:
        """Marca la sesión como revocada durante ``ttl_seconds``.

        Redis borra la clave automáticamente cuando el access token ya habría
        expirado, así que la blacklist no crece indefinidamente.
        """
        if self._redis is None or ttl_seconds <= 0:
            return

        key = f"{self.prefix}sid:{session_id}"
        try:
            await self._redis.set(key, "1", ex=ttl_seconds)
        except Exception:
            # Igual que RabbitMQ en el registro: una caída de Redis no debe
            # impedir que el logout responda. La sesión ya quedó revocada en
            # PostgreSQL para las rutas de auth; el gateway queda fail-open.
            logger.exception(
                "No se pudo registrar la sesión revocada %s en Redis", session_id
            )

    async def close(self) -> None:
        if self._redis is not None:
            await self._redis.aclose()
