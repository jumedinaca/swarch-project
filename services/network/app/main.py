from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from app.api import friends_router
from app.api import requests_router
from app.core.config import Settings,get_settings, isDev
from app.core.database import new_lifespan
from app.core.errors import register_error_handlers
from app.gql.schema import create_graphql_router


def create_app(settings: Settings | None = None) -> FastAPI:

    settings = settings or get_settings()

    app = FastAPI(
        title=settings.APP_NAME,
        description="Service for managing relationships between users.",
        version="1.0.0",
        lifespan=new_lifespan(settings)
    )

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

    app.include_router(requests_router)
    app.include_router(friends_router)
    # Mismas operaciones expuestas como GraphQL (segundo tipo de conector HTTP)
    app.include_router(create_graphql_router(), prefix="/graphql", tags=["GraphQL"])

    return app

if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run("app.main:create_app", factory=True, host="0.0.0.0", port=settings.PORT, reload=isDev())