"""
API GraphQL del servicio de red social (única interfaz del servicio).

Los resolvers delegan en los servicios de negocio (app/services). Se eligió
GraphQL porque la pantalla de amigos pide en una sola petición exactamente lo
que necesita (por ejemplo amigos + solicitudes recibidas + enviadas).
"""
import logging
from collections.abc import Awaitable
from datetime import datetime
from typing import TypeVar
from uuid import UUID, uuid4

import strawberry
from fastapi import Depends
from graphql import GraphQLError
from pymongo.errors import DuplicateKeyError
from strawberry.fastapi import BaseContext, GraphQLRouter
from strawberry.types import Info

from app.core.depends import (
    get_activity_publisher,
    get_current_user,
    get_friends_service,
    get_request_service_service,
)
from app.messaging.events import ActivityCreatedEvent, ActivityCreatedPayload
from app.messaging.publisher import ActivityEventPublisher
from app.models import Friendship as FriendshipModel
from app.models import FriendshipStatus as FriendshipStatusModel
from app.services import FriendsService, RequestService
from app.services.requests_service import (
    FriendshipAlreadyExistsError,
    FriendshipError,
    FriendshipNotFoundError,
    FriendshipPermissionError,
)

T = TypeVar("T")

MAX_PAGE_SIZE = 100
logger = logging.getLogger(__name__)


# ==========================================
# Contexto: usuario actual (validado por el middleware JWT) y servicios
# ==========================================

class NetworkContext(BaseContext):
    def __init__(
        self,
        user_id: UUID,
        requests: RequestService,
        friends: FriendsService,
        publisher: ActivityEventPublisher | None,
    ):
        super().__init__()
        self.user_id = user_id
        self.requests = requests
        self.friends = friends
        self.publisher = publisher


async def get_context(
    user_id: UUID = Depends(get_current_user),
    requests: RequestService = Depends(get_request_service_service),
    friends: FriendsService = Depends(get_friends_service),
    publisher: ActivityEventPublisher | None = Depends(get_activity_publisher),
) -> NetworkContext:
    return NetworkContext(user_id, requests, friends, publisher)


# ==========================================
# Errores: se traducen a errores GraphQL con un código en `extensions`
# ==========================================

ERROR_CODES = {
    FriendshipNotFoundError: "NOT_FOUND",
    FriendshipPermissionError: "FORBIDDEN",
    FriendshipAlreadyExistsError: "CONFLICT",
}


async def run(operation: Awaitable[T]) -> T:
    try:
        return await operation
    except FriendshipError as exc:
        raise GraphQLError(str(exc), extensions={"code": ERROR_CODES.get(type(exc), "BAD_REQUEST")})
    except DuplicateKeyError:
        raise GraphQLError(
            "Ya existe una relación o solicitud entre estos usuarios.", extensions={"code": "CONFLICT"}
        )
    except ValueError as exc:
        raise GraphQLError(str(exc), extensions={"code": "BAD_REQUEST"})


def check_limit(limit: int) -> None:
    if not 1 <= limit <= MAX_PAGE_SIZE:
        raise GraphQLError(
            f"limit debe estar entre 1 y {MAX_PAGE_SIZE}.", extensions={"code": "BAD_REQUEST"}
        )


async def publish_activity(
    publisher: ActivityEventPublisher | None,
    *,
    user_id: UUID,
    actor_id: UUID,
    activity_type: str,
    entity_id: str,
    summary: str,
) -> None:
    """Publica después de persistir. Un fallo del broker no rompe la mutación."""
    if publisher is None:
        return

    try:
        await publisher.publish(
            ActivityCreatedEvent(
                payload=ActivityCreatedPayload(
                    activity_id=uuid4(),
                    user_id=user_id,
                    actor_id=actor_id,
                    type=activity_type,
                    entity_id=entity_id,
                    summary=summary,
                )
            )
        )
    except Exception:
        logger.exception(
            "No se pudo publicar activity.created.v1",
            extra={"activityType": activity_type, "entityId": entity_id},
        )


# ==========================================
# Tipos
# ==========================================

FriendshipStatus = strawberry.enum(FriendshipStatusModel, name="FriendshipStatus")


@strawberry.type(description="Relación entre dos usuarios: solicitud pendiente o amistad aceptada.")
class Friendship:
    id: strawberry.ID
    user_a: UUID
    user_b: UUID
    status: FriendshipStatus
    requested_by: UUID
    created_at: datetime
    updated_at: datetime

    @strawberry.field(description="El otro usuario de la relación, visto desde el usuario actual.")
    def other_user_id(self, info: Info[NetworkContext, None]) -> UUID:
        return self.user_b if self.user_a == info.context.user_id else self.user_a

    @strawberry.field(description="true si la solicitud la envió el usuario actual.")
    def sent_by_me(self, info: Info[NetworkContext, None]) -> bool:
        return self.requested_by == info.context.user_id

    @staticmethod
    def from_model(model: FriendshipModel) -> "Friendship":
        return Friendship(
            id=strawberry.ID(model.id),
            user_a=UUID(model.user_a),
            user_b=UUID(model.user_b),
            status=model.status,
            requested_by=UUID(model.requested_by),
            created_at=model.created_at,
            updated_at=model.updated_at,
        )


def to_list(models: list[FriendshipModel]) -> list[Friendship]:
    return [Friendship.from_model(m) for m in models]


# ==========================================
# Consultas
# ==========================================

@strawberry.type
class Query:
    @strawberry.field(description="Id del usuario autenticado.")
    def me(self, info: Info[NetworkContext, None]) -> UUID:
        return info.context.user_id

    @strawberry.field(description="Amistades aceptadas del usuario actual.")
    async def friends(
        self, info: Info[NetworkContext, None], limit: int = 20, cursor: str | None = None
    ) -> list[Friendship]:
        check_limit(limit)
        ctx = info.context
        return to_list(await run(ctx.friends.get_friends(ctx.user_id, limit=limit, cursor=cursor)))

    @strawberry.field(description="Solicitudes pendientes que otros usuarios le enviaron al usuario actual.")
    async def incoming_requests(
        self, info: Info[NetworkContext, None], limit: int = 20, cursor: str | None = None
    ) -> list[Friendship]:
        check_limit(limit)
        ctx = info.context
        return to_list(
            await run(
                ctx.requests.list_for_user(
                    user_id=ctx.user_id,
                    requested_from_user=False,
                    status=FriendshipStatusModel.PENDING,
                    limit=limit,
                    cursor=cursor,
                )
            )
        )

    @strawberry.field(description="Solicitudes pendientes que el usuario actual envió.")
    async def outgoing_requests(
        self, info: Info[NetworkContext, None], limit: int = 20, cursor: str | None = None
    ) -> list[Friendship]:
        check_limit(limit)
        ctx = info.context
        return to_list(
            await run(
                ctx.requests.list_for_user(
                    user_id=ctx.user_id,
                    requested_from_user=True,
                    status=FriendshipStatusModel.PENDING,
                    limit=limit,
                    cursor=cursor,
                )
            )
        )

    @strawberry.field(description="Una relación por id (solo si el usuario actual pertenece a ella).")
    async def friendship(self, info: Info[NetworkContext, None], id: strawberry.ID) -> Friendship:
        ctx = info.context
        return Friendship.from_model(await run(ctx.requests.get_frienship_by_id(ctx.user_id, str(id))))


# ==========================================
# Mutaciones
# ==========================================

@strawberry.type
class Mutation:
    @strawberry.mutation(description="Envía una solicitud de amistad.")
    async def send_friend_request(
        self, info: Info[NetworkContext, None], recipient_id: UUID
    ) -> Friendship:
        ctx = info.context
        friendship = await run(
            ctx.requests.create_request(requester_id=ctx.user_id, recipient_id=recipient_id)
        )

        await publish_activity(
            ctx.publisher,
            user_id=recipient_id,
            actor_id=ctx.user_id,
            activity_type="FRIEND_REQUEST_SENT",
            entity_id=friendship.id,
            summary="Recibiste una solicitud de amistad",
        )

        return Friendship.from_model(friendship)

    @strawberry.mutation(description="Acepta una solicitud recibida.")
    async def accept_friend_request(self, info: Info[NetworkContext, None], id: strawberry.ID) -> Friendship:
        ctx = info.context
        friendship = await run(ctx.requests.accept_request(str(id), ctx.user_id))

        await publish_activity(
            ctx.publisher,
            user_id=UUID(friendship.requested_by),
            actor_id=ctx.user_id,
            activity_type="FRIEND_REQUEST_ACCEPTED",
            entity_id=friendship.id,
            summary="Aceptó tu solicitud de amistad",
        )

        return Friendship.from_model(friendship)

    @strawberry.mutation(description="Rechaza una solicitud recibida.")
    async def reject_friend_request(self, info: Info[NetworkContext, None], id: strawberry.ID) -> bool:
        ctx = info.context
        friendship = await run(ctx.requests.reject_request(str(id), ctx.user_id))

        await publish_activity(
            ctx.publisher,
            user_id=UUID(friendship.requested_by),
            actor_id=ctx.user_id,
            activity_type="FRIEND_REQUEST_REJECTED",
            entity_id=friendship.id,
            summary="Rechazó tu solicitud de amistad",
        )

        return True

    @strawberry.mutation(description="Cancela una solicitud enviada.")
    async def cancel_friend_request(self, info: Info[NetworkContext, None], id: strawberry.ID) -> bool:
        ctx = info.context
        await run(ctx.requests.cancel_request(str(id), ctx.user_id))
        return True

    @strawberry.mutation(description="Elimina una amistad.")
    async def remove_friend(self, info: Info[NetworkContext, None], friend_id: UUID) -> bool:
        ctx = info.context
        await run(ctx.friends.delete_friend(ctx.user_id, friend_id))
        return True


schema = strawberry.Schema(query=Query, mutation=Mutation)


def create_graphql_router() -> GraphQLRouter:
    # GraphiQL (IDE en el navegador) en GET /graphql; las consultas van por POST /graphql
    return GraphQLRouter(schema, context_getter=get_context, graphql_ide="graphiql")
