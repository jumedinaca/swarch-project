import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import Settings, get_settings
from app.core.ratelimit import UploadRateLimiter
from app.db.session import create_engine, create_session_factory
from app.handler.deps import build_profile_service
from app.handler.errors import register_error_handlers
from app.handler.profile_handler import router as profile_router
from app.messaging import ProfileEventPublisher, RabbitMQConnection, UserEventConsumer
from app.storage.avatar_storage import MinioAvatarStorage

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = create_engine(settings.database_url)
    session_factory = create_session_factory(engine)

    storage = (
        MinioAvatarStorage(
            settings.minio_endpoint,
            settings.minio_access_key,
            settings.minio_secret_key,
            settings.minio_bucket,
            secure=settings.minio_secure,
        )
        if settings.minio_endpoint
        else None
    )

    # Si no hay RABBITMQ_URL, los eventos quedan deshabilitados: los perfiles se
    # crean de forma perezosa en GET /profiles/me.
    connection = RabbitMQConnection(settings.rabbitmq_url) if settings.rabbitmq_url else None
    publisher = ProfileEventPublisher(connection, settings.rabbitmq_exchange) if connection else None

    @asynccontextmanager
    async def service_scope():
        # Cada evento usa su propia sesión de BD, igual que una petición HTTP.
        async with app.state.session_factory() as db:
            yield build_profile_service(app, db)

    consumer = (
        UserEventConsumer(connection, settings.rabbitmq_exchange, service_scope) if connection else None
    )

    async def prepare_bucket() -> None:
        try:
            await app.state.avatar_storage.initialize()
        except Exception:
            logger.exception("No se pudo preparar el bucket de avatares; se reintentará al subir.")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Ni MinIO ni RabbitMQ bloquean el arranque: el servicio responde aunque falten.
        tasks = []
        if app.state.avatar_storage is not None:
            tasks.append(asyncio.create_task(prepare_bucket()))
        if consumer is not None:
            tasks.append(asyncio.create_task(consumer.run_forever()))
        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
            for task in tasks:
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            if connection is not None:
                await connection.close()
            await engine.dispose()

    app = FastAPI(
        title="GeoPicto - Servicio de Perfiles",
        version="1.0.0",
        description="Nombre visible, descripción, avatar y color de autor de cada usuario.",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = session_factory
    app.state.avatar_storage = storage
    app.state.profile_event_publisher = publisher
    app.state.service_scope = service_scope
    app.state.user_event_consumer = consumer
    app.state.upload_limiter = UploadRateLimiter(settings.avatar_uploads_per_hour)

    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    register_error_handlers(app)
    app.include_router(profile_router)

    @app.get("/health", tags=["health"])
    async def health(request: Request):
        checks = {"database": "ok", "storage": "disabled"}
        try:
            async with request.app.state.engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        except Exception:
            checks["database"] = "unavailable"

        if request.app.state.avatar_storage is not None:
            ok = await request.app.state.avatar_storage.ping()
            checks["storage"] = "ok" if ok else "unavailable"

        healthy = "unavailable" not in checks.values()
        return JSONResponse({"status": "ok" if healthy else "degraded", **checks}, 200 if healthy else 503)

    return app
