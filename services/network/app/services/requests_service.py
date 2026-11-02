"""
Service for handling request between users
"""

from datetime import datetime, timezone
import base64
import json
import threading
import urllib.request
from uuid import UUID, uuid4

from app.models import Friendship, FriendshipStatus
from app.repositories.friendship_repository import FriendshipRepository


def _publish_rabbit_event(routing_key: str, envelope: dict) -> None:
    def _send():
        try:
            url = "http://rabbitmq:15672/api/exchanges/geopicto/geopicto.events/publish"
            body = json.dumps({
                "properties": {},
                "routing_key": routing_key,
                "payload": json.dumps(envelope),
                "payload_encoding": "string",
            }).encode("utf-8")
            auth = base64.b64encode(b"geopicto:geopicto").decode("ascii")
            req = urllib.request.Request(
                url,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Basic {auth}",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=2) as _:
                pass
        except Exception:
            pass

    threading.Thread(target=_send, daemon=True).start()


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

        created = await self.repository.create(
            user_a=str(requester_id),
            user_b=str(recipient_id),
            requested_by=str(requester_id),
        )

        now_iso = datetime.now(timezone.utc).isoformat()
        _publish_rabbit_event(
            "notification.requested.v1",
            {
                "eventId": str(uuid4()),
                "event": "notification.requested.v1",
                "occurredAt": now_iso,
                "payload": {
                    "userId": str(recipient_id),
                    "type": "FRIEND_REQUEST",
                    "title": "Nueva solicitud de amistad",
                    "body": f"El explorador {str(requester_id)[:6]} quiere agregarte a su red.",
                    "referenceId": str(created.id),
                },
            },
        )
        return created

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

        now_iso = datetime.now(timezone.utc).isoformat()
        _publish_rabbit_event(
            "activity.created.v1",
            {
                "eventId": str(uuid4()),
                "event": "activity.created.v1",
                "occurredAt": now_iso,
                "payload": {
                    "userId": str(friendship.requested_by),
                    "actorId": str(actor_id),
                    "activityType": "FRIEND_ACCEPTED",
                    "referenceId": str(updated.id),
                    "summary": f"El explorador {str(actor_id)[:6]} aceptó tu solicitud de amistad.",
                },
            },
        )
        _publish_rabbit_event(
            "activity.created.v1",
            {
                "eventId": str(uuid4()),
                "event": "activity.created.v1",
                "occurredAt": now_iso,
                "payload": {
                    "userId": str(actor_id),
                    "actorId": str(actor_id),
                    "activityType": "FRIEND_ACCEPTED_SELF",
                    "referenceId": str(updated.id),
                    "summary": "",
                },
            },
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

        recipient_id = (
            friendship.user_b
            if str(friendship.user_a) == str(actor_id)
            else friendship.user_a
        )
        now_iso = datetime.now(timezone.utc).isoformat()
        _publish_rabbit_event(
            "activity.created.v1",
            {
                "eventId": str(uuid4()),
                "event": "activity.created.v1",
                "occurredAt": now_iso,
                "payload": {
                    "userId": str(recipient_id),
                    "actorId": str(actor_id),
                    "activityType": "FRIEND_REQUEST_CANCELLED",
                    "referenceId": str(friendship.id),
                    "summary": f"El explorador {str(actor_id)[:6]} canceló su solicitud de amistad.",
                },
            },
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

        now_iso = datetime.now(timezone.utc).isoformat()
        _publish_rabbit_event(
            "activity.created.v1",
            {
                "eventId": str(uuid4()),
                "event": "activity.created.v1",
                "occurredAt": now_iso,
                "payload": {
                    "userId": str(friendship.requested_by),
                    "actorId": str(actor_id),
                    "activityType": "FRIEND_REQUEST_REJECTED",
                    "referenceId": str(friendship.id),
                    "summary": f"El explorador {str(actor_id)[:6]} rechazó tu solicitud de amistad.",
                },
            },
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