from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import Settings, get_settings
from app.db.session import create_engine, create_session_factory
from app.handler.auth_handler import router as auth_router
from app.handler.errors import error_body, register_error_handlers


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = create_engine(settings.database_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
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
