from uuid import UUID

from fastapi import Depends, Header, HTTPException, Request
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import get_settings, isDev
from app.repositories.friendship_repository import FriendshipRepository
from app.services import FriendsService, RequestService


def get_current_user(
    x_user_id: str | None = Header(default=None, alias="X-User-ID"),
) -> UUID:
    """
    El API Gateway valida el JWT y reenvía el id del usuario en X-User-ID
    (igual que con el servicio de mensajes). Este servicio confía en ese header.
    En desarrollo, sin gateway, se puede usar DEV_USER_ID como respaldo.
    """
    value = x_user_id
    if not value and isDev():
        value = get_settings().DEV_USER_ID

    try:
        return UUID(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Falta un X-User-ID válido.")


def get_database(request: Request) -> AsyncDatabase:
    return request.app.state.mongodb


def get_request_service_service(
    database: AsyncDatabase = Depends(get_database),
) -> RequestService:
    repository = FriendshipRepository(database["friendships"])
    return RequestService(repository)


def get_friends_service(
    database: AsyncDatabase = Depends(get_database),
) -> FriendsService:
    repository = FriendshipRepository(database["friendships"])
    return FriendsService(repository)
