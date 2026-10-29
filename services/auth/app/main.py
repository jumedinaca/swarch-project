import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import Settings, get_settings
from app.db.session import create_engine, create_session_factory
from app.handler.auth_handler import router as auth_router
from app.handler.errors import error_body, register_error_handlers
from app.messaging import RabbitMQConnection, UserEventPublisher

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = create_engine(settings.database_url)

    # Si no hay RABBITMQ_URL, los eventos quedan deshabilitados y el servicio
    # funciona igual (registro/login no dependen del broker).
    connection = (
        RabbitMQConnection(settings.rabbitmq_url) if settings.rabbitmq_url else None
    )
    publisher = (
        UserEventPublisher(connection, settings.rabbitmq_exchange) if connection else None
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if publisher is not None:
            try:
                await publisher.initialize()
            except Exception:
                # El registro debe seguir respondiendo 201 aunque RabbitMQ esté caído.
                logger.exception(
                    "No se pudo conectar a RabbitMQ; los eventos se reintentarán al publicar."
                )

        try:
            yield
        finally:
            if connection is not None:
                await connection.close()
            await engine.dispose()

    app = FastAPI(
        title="GeoPicto - Servicio de Autenticación",
        version="1.0.0",
        description="Registro, login, emisión/validación de JWT y gestión de sesiones.",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = create_session_factory(engine)
    app.state.user_event_publisher = publisher

    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    register_error_handlers(app)
    app.include_router(auth_router)

    @app.get("/health", tags=["health"])
    async def health(request: Request):
        try:
            async with request.app.state.engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        except Exception:
            return JSONResponse(error_body("db_unavailable", "Base de datos no disponible."), 503)
        return {"success": True, "status": "ok"}

    return app
