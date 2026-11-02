from collections.abc import AsyncIterator

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import InvalidTokenError, TokenClaims, decode_access_token
from app.service.profile_service import ProfileError, ProfileService

_bearer = HTTPBearer(auto_error=False)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.session_factory() as session:
        yield session


def build_profile_service(app, db: AsyncSession) -> ProfileService:
    """Lo usan las rutas HTTP y el consumidor de eventos."""
    return ProfileService(
        db,
        app.state.settings,
        app.state.avatar_storage,
        app.state.profile_event_publisher,
        app.state.upload_limiter,
    )


def get_profile_service(request: Request, db: AsyncSession = Depends(get_db)) -> ProfileService:
    return build_profile_service(request.app, db)


def get_claims(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> TokenClaims:
    # El gateway ya validó el token, pero el servicio no confía en X-User-ID:
    # vuelve a validarlo y toma el usuario del claim sub (defensa en profundidad).
    if credentials is None:
        raise ProfileError(401, "missing_token", "Falta el encabezado Authorization: Bearer <token>.")
    try:
        return decode_access_token(request.app.state.settings, credentials.credentials)
    except InvalidTokenError as exc:
        raise ProfileError(401, "invalid_token", str(exc)) from exc
