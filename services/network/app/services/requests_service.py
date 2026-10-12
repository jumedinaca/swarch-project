"""
Service for handling request between users
"""

from uuid import UUID

from app.models import Friendship, FriendshipStatus
from app.repositories.friendship_repository import FriendshipRepository


class FriendshipError(Exception):
    """Error de negocio relacionado con amistades."""


class FriendshipAlreadyExistsError(FriendshipError):
    pass


class FriendshipNotFoundError(FriendshipError):
    pass


class FriendshipPermissionError(FriendshipError):
    pass


class InvalidFriendshipOperationError(FriendshipError):
    pass


class RequestService:
    def __init__(self, repository: FriendshipRepository):
        self.repository = repository

    async def create_request(
        self,
        requester_id: UUID,
        recipient_id: UUID,
    ) -> Friendship:
        if requester_id == recipient_id:
            raise InvalidFriendshipOperationError(
                "No puedes enviarte una solicitud a ti mismo."
            )

        existing = await self.repository.get_by_pair(
            str(requester_id),
            str(recipient_id),
        )

        if existing is not None:
            raise FriendshipAlreadyExistsError(
                "Ya existe una relación o solicitud entre estos usuarios."
            )

        return await self.repository.create(
            user_a=str(requester_id),
            user_b=str(recipient_id),
            requested_by=str(requester_id),
        )

    async def accept_request(
        self,
        friendship_id: str,
        actor_id: UUID,
    ) -> Friendship:
        friendship = await self.repository.get_by_id(friendship_id)

        if friendship is None:
            raise FriendshipNotFoundError(
                "No se encontró la solicitud."
            )

        if friendship.status != FriendshipStatus.PENDING:
            raise InvalidFriendshipOperationError(
                "La solicitud ya no está pendiente."
            )

        if str(actor_id) not in (friendship.user_a, friendship.user_b):
            raise FriendshipPermissionError(
                "No perteneces a esta solicitud."
            )

        if str(actor_id) == friendship.requested_by:
            raise FriendshipPermissionError(
                "No puedes aceptar tu propia solicitud."
            )

        updated = await self.repository.update_status(
            friendship_id=friendship_id,
            expected_status=FriendshipStatus.PENDING,
            new_status=FriendshipStatus.ACCEPTED,
        )

        if updated is None:
            raise InvalidFriendshipOperationError(
                "La solicitud cambió mientras intentabas aceptarla."
            )

        return updated

    async def cancel_request(
        self,
        friendship_id: str,
        actor_id: UUID,
    ) -> None:
        friendship = await self.repository.get_by_id(friendship_id)

        if friendship is None:
            raise FriendshipNotFoundError(
                "No se encontró la solicitud."
            )

        if friendship.status != FriendshipStatus.PENDING:
            raise InvalidFriendshipOperationError(
                "Solo puedes cancelar solicitudes pendientes."
            )

        if str(actor_id) != friendship.requested_by:
            raise FriendshipPermissionError(
                "Solo quien envió la solicitud puede cancelarla."
            )

        deleted = await self.repository.delete_pending(friendship_id)

        if not deleted:
            raise InvalidFriendshipOperationError(
                "La solicitud cambió antes de poder cancelarla."
            )

    async def reject_request(
        self,
        friendship_id: str,
        actor_id: UUID,
    ) -> None:
        friendship = await self.repository.get_by_id(friendship_id)

        if friendship is None:
            raise FriendshipNotFoundError(
                "No se encontró la solicitud."
            )

        if friendship.status != FriendshipStatus.PENDING:
            raise InvalidFriendshipOperationError(
                "Solo puedes rechazar solicitudes pendientes."
            )

        if str(actor_id) not in (friendship.user_a, friendship.user_b):
            raise FriendshipPermissionError(
                "No perteneces a esta solicitud."
            )

        if str(actor_id) == friendship.requested_by:
            raise FriendshipPermissionError(
                "No puedes rechazar tu propia solicitud (Usa /cancel para cancelar)."
            )

        deleted = await self.repository.delete_pending(friendship_id=friendship.id)

        if not deleted:
            raise InvalidFriendshipOperationError(
                "La solicitud cambió antes de poder rechazarla."
            )
        

    async def list_for_user(
        self,
        user_id: UUID,
        requested_from_user: bool | None = True,
        status: FriendshipStatus | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> list[Friendship]:
        if not 1 <= limit <= 100:
            raise ValueError("El límite debe estar entre 1 y 100.")

        return await self.repository.list_for_user(
            user_id=str(user_id),
            is_requested_by_user=requested_from_user,
            status=status,
            limit=limit,
            cursor=cursor,
        )

    async def get_frienship_by_id(
        self,
        user_id: UUID,
        friendship_id: str
    ):
        friendship = await self.repository.get_by_id(
            friendship_id=friendship_id
        )

        if not friendship:
            raise FriendshipNotFoundError(
                "No se encontró la solicitud."
            )

        if str(user_id) not in (friendship.user_a, friendship.user_b):
            raise FriendshipPermissionError(
                "No perteneces a esta solicitud."
            )
        
        return friendship