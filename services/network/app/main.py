import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from app.core.config import Settings, get_settings, isDev
from app.core.database import new_lifespan
from app.core.errors import register_error_handlers
from app.core.middleware import JWTAuthMiddleware
from app.gql.schema import create_graphql_router
from app.messaging import ActivityEventPublisher, RabbitMQConnection

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:

    settings = settings or get_settings()

    # Si no hay RABBITMQ_URL, la publicación de actividad queda deshabilitada
    # y el servicio funciona igual.
    connection = RabbitMQConnection(settings.RABBITMQ_URL) if settings.RABBITMQ_URL else None
    publisher = (
        ActivityEventPublisher(connection, settings.RABBITMQ_EXCHANGE) if connection else None
    )

    mongo_lifespan = new_lifespan(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with mongo_lifespan(app):
            if publisher is not None:
                try:
                    await publisher.initialize()
                except Exception:
                    # Las mutaciones deben seguir funcionando aunque el broker
                    # esté caído; se reintenta al publicar.
                    logger.exception(
                        "No se pudo conectar a RabbitMQ; los eventos se reintentarán al publicar."
                    )

            try:
                yield
            finally:
                if connection is not None:
                    await connection.close()

    app = FastAPI(
        title=settings.APP_NAME,
        description="Service for managing relationships between users.",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.state.settings = settings
    app.state.activity_publisher = publisher

    # El JWT se valida en este servicio, no solo en el gateway. Se agrega antes
    # que CORS para que CORS quede como middleware más externo y añada sus
    # cabeceras también en las respuestas 401.
    app.add_middleware(JWTAuthMiddleware, settings=settings)

    # Detrás del gateway CORS_ORIGINS queda vacío: si ambos agregaran las
    # cabeceras CORS, el navegador rechazaría las respuestas.
    origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=origins != ["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )

    register_error_handlers(app)

    @app.get("/", tags=["Health"])
    def health_check():
        return {"status": "ok", "service": settings.APP_NAME}

    # La API del servicio es GraphQL: un único endpoint en /graphql
    app.include_router(create_graphql_router(), prefix="/graphql", tags=["GraphQL"])

    return app


if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host="0.0.0.0",
        port=settings.PORT,
        reload=isDev(),
    )
