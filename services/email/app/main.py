import asyncio
import contextlib
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import Settings, get_settings
from app.core.logging import configure_logging, get_logger, sanitize_error
from app.core.ratelimit import SlidingWindowRateLimiter
from app.db.session import create_engine, create_session_factory
from app.handler.deps import build_email_service
from app.handler.email_handler import router as email_router
from app.handler.errors import register_error_handlers
from app.messaging import (
    EmailEventConsumer,
    EmailEventPublisher,
    EmailJobDispatcher,
    LocalEmailWorker,
    RabbitMQConnection,
)
from app.repository.email_repository import EmailRepository
from app.service.smtp_client import SmtpClient
from app.service.template_renderer import TemplateRenderer

logger = get_logger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    configure_logging()
    settings = settings or get_settings()

    engine = create_engine(settings.database_url)
    session_factory = create_session_factory(engine)
    renderer = TemplateRenderer()
    smtp_client = SmtpClient(
        host=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_username,
        password=settings.smtp_password,
        use_tls=settings.smtp_use_tls,
        start_tls=settings.smtp_starttls,
        timeout=settings.smtp_timeout_seconds,
        smtp_from=settings.smtp_from,
        default_reply_to=settings.default_reply_to,
    )
    global_limiter = SlidingWindowRateLimiter(
        limit=settings.global_rate_limit_per_minute,
        window_seconds=60.0,
    )

    connection = RabbitMQConnection(settings.rabbitmq_url) if settings.rabbitmq_url else None
    publisher = EmailEventPublisher(connection, settings.rabbitmq_exchange) if connection else None

    @asynccontextmanager
    async def service_scope():
        async with app.state.session_factory() as db:
            yield build_email_service(app, db)

    local_worker = LocalEmailWorker(service_scope)
    job_dispatcher = EmailJobDispatcher(publisher, local_worker)
    consumer = (
        EmailEventConsumer(
            connection=connection,
            exchange_name=settings.rabbitmq_exchange,
            retry_delays_seconds=settings.retry_delays_list,
            service_scope=service_scope,
        )
        if connection is not None
        else None
    )

    async def retention_sweep_loop() -> None:
        while True:
            await asyncio.sleep(max(60, settings.retention_sweep_seconds))
            try:
                async with app.state.session_factory() as db:
                    purged = await EmailRepository(db).purge_expired(settings.retention_days)
                    if purged:
                        logger.info("email.retention_purged", count=purged, retention_days=settings.retention_days)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("email.retention_sweep_failed", error=sanitize_error(exc))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        tasks: list[asyncio.Task[None]] = [
            asyncio.create_task(local_worker.run_forever()),
            asyncio.create_task(retention_sweep_loop()),
        ]
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
        title="GeoPicto - Servicio de Email",
        version="1.0.0",
        description="Envío asíncrono de correos transaccionales a partir de eventos.",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = session_factory
    app.state.template_renderer = renderer
    app.state.smtp_client = smtp_client
    app.state.global_limiter = global_limiter
    app.state.rabbitmq_connection = connection
    app.state.event_publisher = publisher
    app.state.local_worker = local_worker
    app.state.job_dispatcher = job_dispatcher
    app.state.event_consumer = consumer
    app.state.service_scope = service_scope

    register_error_handlers(app)
    app.include_router(email_router)

    @app.get("/health", tags=["health"])
    async def health(request: Request):
        checks: dict[str, str] = {"database": "ok", "smtp": "ok", "broker": "disabled"}

        try:
            async with request.app.state.engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        except Exception:
            checks["database"] = "unavailable"

        smtp_ok = await request.app.state.smtp_client.ping()
        if not smtp_ok:
            checks["smtp"] = "unavailable"

        if request.app.state.rabbitmq_connection is not None:
            checks["broker"] = "ok" if request.app.state.rabbitmq_connection.is_connected else "unavailable"

        healthy = checks["database"] == "ok" and checks["smtp"] == "ok" and checks["broker"] != "unavailable"
        return JSONResponse(
            {"status": "ok" if healthy else "degraded", **checks},
            200 if healthy else 503,
        )

    return app
