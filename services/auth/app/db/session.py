from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def to_async_url(url: str) -> str:
    """Acepta postgres:// o postgresql:// (formato del servicio de mensajes) y usa asyncpg."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+asyncpg://" + url[len(prefix):]
    return url


def create_engine(database_url: str) -> AsyncEngine:
    return create_async_engine(to_async_url(database_url), pool_pre_ping=True)


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)

