import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import Settings, get_settings
from app.db.session import create_engine, create_session_factory
from app.handler.moderation_handler import build_moderation_service
from app.handler.moderation_handler import router as moderation_router
from app.messaging import MessageEventConsumer, ModerationEventPublisher, RabbitMQConnection
from app.service.classifier import OpenAIModerationClassifier
from app.service.rules import RuleEngine

logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = create_engine(settings.database_url)
    session_factory = create_session_factory(engine)

    # Las reglas se cargan una sola vez; si el YAML es inválido, el servicio no arranca.
    rules = RuleEngine.from_file(settings.rules_path)

    classifier = (
        OpenAIModerationClassifier(
            settings.openai_api_key,
            model=settings.openai_model,
            base_url=settings.openai_base_url,
            timeout_seconds=settings.openai_timeout_seconds,
            block_threshold=settings.block_threshold,
            warn_threshold=settings.warn_threshold,
        )
        if settings.openai_api_key
        else None
    )
    if classifier is None:
        logger.warning("OPENAI_API_KEY vacío: se modera solo con reglas (degraded = true).")

    # Si no hay RABBITMQ_URL, solo queda la API interna.
    connection = RabbitMQConnection(settings.rabbitmq_url) if settings.rabbitmq_url else None
    publisher = ModerationEventPublisher(connection, settings.rabbitmq_exchange) if connection else None

    @asynccontextmanager
    async def service_scope():
        # Cada evento usa su propia sesión de BD, igual que una petición HTTP.
        async with app.state.session_factory() as db:
            yield build_moderation_service(app, db)

    consumer = (
        MessageEventConsumer(
            connection,
            settings.rabbitmq_exchange,
            service_scope,
            publisher,
            max_attempts=settings.max_attempts,
            retry_base_seconds=settings.retry_base_seconds,
        )
        if connection
        else None
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # RabbitMQ no bloquea el arranque: el servicio responde aunque falte.
        task = asyncio.create_task(consumer.run_forever()) if consumer is not None else None
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            if connection is not None:
                await connection.close()
            if classifier is not None:
                await classifier.aclose()
            await engine.dispose()

    app = FastAPI(
        title="GeoPicto - Servicio de Moderación",
        version="1.0.0",
        description="Decide si un mensaje se publica, se publica con advertencia o se bloquea.",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = session_factory
    app.state.rules = rules
    app.state.classifier = classifier
    app.state.moderation_event_publisher = publisher
    app.state.service_scope = service_scope
    app.state.message_event_consumer = consumer

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_: Request, exc: StarletteHTTPException):
        code = {401: "unauthorized", 404: "not_found"}.get(exc.status_code, "http_error")
        return JSONResponse({"error": code, "message": str(exc.detail)}, exc.status_code)

    app.include_router(moderation_router)

    @app.get("/health", tags=["health"])
    async def health(request: Request):
        state = request.app.state
        checks = {
            "database": "ok",
            "broker": "disabled",
            # Sin clasificador el servicio sigue funcionando con reglas.
            "classifier": state.classifier.name if state.classifier is not None else "rules-only",
            "ruleVersion": state.rules.version,
        }
        try:
            async with state.engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        except Exception:
            checks["database"] = "unavailable"

        if state.message_event_consumer is not None:
            checks["broker"] = "ok" if state.message_event_consumer.ready else "connecting"

        healthy = checks["database"] == "ok"
        return JSONResponse({"status": "ok" if healthy else "degraded", **checks}, 200 if healthy else 503)

    return app
