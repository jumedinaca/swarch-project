from collections.abc import AsyncIterator
from dataclasses import dataclass

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import AccessTokenClaims
from app.domain.models import Session, User
from app.messaging.publisher import UserEventPublisher
from app.service.auth_service import AuthError, AuthService, ClientInfo

_bearer = HTTPBearer(auto_error=False)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.session_factory() as session:
        yield session


def get_user_event_publisher(request: Request) -> UserEventPublisher | None:
    return request.app.state.user_event_publisher


def get_auth_service(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user_event_publisher: UserEventPublisher | None = Depends(get_user_event_publisher),
) -> AuthService:
    return AuthService(db, request.app.state.settings, user_event_publisher)


def get_client_info(request: Request) -> ClientInfo:
    # Detrás del API Gateway la IP real llega en X-Forwarded-For
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None)
    return ClientInfo(user_agent=request.headers.get("user-agent"), ip_address=ip)


@dataclass
class CurrentAuth:
    user: User
    session: Session
    claims: AccessTokenClaims


async def get_current_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    service: AuthService = Depends(get_auth_service),
) -> CurrentAuth:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AuthError(401, "missing_token", "Falta el encabezado Authorization: Bearer <token>.")
    user, session, claims = await service.authenticate(credentials.credentials)
    return CurrentAuth(user, session, claims)
