from uuid import UUID

from fastapi import Depends, HTTPException, Request
from pymongo.asynchronous.database import AsyncDatabase

from app.messaging.publisher import ActivityEventPublisher
from app.repositories.friendship_repository import FriendshipRepository
from app.services import FriendsService, RequestService


def get_current_user(request: Request) -> UUID:
    """
    El middleware JWTAuth valida el token y deja el UUID del claim sub en
    request.state.user_id. Este servicio no confía en X-User-ID.
    """
    user_id = getattr(request.state, "user_id", None)
    if not isinstance(user_id, UUID):
        raise HTTPException(status_code=401, detail="Token de autenticación requerido.")
    return user_id


def get_database(request: Request) -> AsyncDatabase:
    return request.app.state.mongodb


def get_activity_publisher(request: Request) -> ActivityEventPublisher | None:
    return getattr(request.app.state, "activity_publisher", None)


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
