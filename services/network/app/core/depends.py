from uuid import UUID

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from jwt.exceptions import InvalidTokenError
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import settings
from app.repositories.friendship_repository import FriendshipRepository
from app.services.friendship_service import FriendshipService

bearer_scheme = HTTPBearer(auto_error=False)

def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> UUID:


    if settings.DEV:
        return UUID(int=1)
    
    if not credentials:
        raise HTTPException(
            status_code=401,
            detail="No token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.PUBLIC_KEY,
            algorithms=[settings.ALGORITHM],
            options={"require": ["exp", "sub"]},
        )

        return UUID(payload["sub"])

    except (InvalidTokenError, ValueError, KeyError):
        raise HTTPException(
            status_code=401,
            detail="Token inválido o expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )

def get_database(request: Request) -> AsyncDatabase:
    return request.app.state.mongodb


def get_friendship_service(
    database: AsyncDatabase = Depends(get_database),
) -> FriendshipService:
    repository = FriendshipRepository(database["friendships"])
    return FriendshipService(repository)
