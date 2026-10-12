import re
from uuid import UUID

from fastapi import APIRouter, Depends

from app.core.depends import get_current_user, get_friendship_service
from app.schemas.friendship import FriendshipCreate, FriendshipResponse, FriendshipListQuery, FriendshipListResponse
from app.services.friendship_service import FriendshipService
from app.models.friendship import FriendshipStatus

router = APIRouter(prefix="/friendships", tags=["Friendships"])

@router.post("", response_model=FriendshipResponse, status_code=201)
async def create_friendship(
    body: FriendshipCreate,
    current_user_id: UUID = Depends(get_current_user),
    service: FriendshipService = Depends(get_friendship_service),
):
    return await service.create_request(
        requester_id=current_user_id,
        recipient_id=body.recipient_id,
    )

@router.get("/outcoming",status_code=201)
async def get_outcoming(
    body: FriendshipListQuery,
    current_user_id: UUID = Depends(get_current_user),
    service: FriendshipService = Depends(get_friendship_service),
):
    return await service.list_for_user(
        user_id=current_user_id,
        requested_from_user=True,
        status=FriendshipStatus.PENDING,
        limit=body.limit,
        cursor=body.cursor,
    )

@router.get("/incoming",status_code=201)
async def get_incoming(
    body: FriendshipListQuery,
    current_user_id: UUID = Depends(get_current_user),
    service: FriendshipService = Depends(get_friendship_service),
):
    return await service.list_for_user(
        user_id=current_user_id,
        requested_from_user=False,
        status=FriendshipStatus.PENDING,
        limit=body.limit,
        cursor=body.cursor,
    )

@router.delete("/{friendship_id}",status_code=201)
async def delete_friendship(
    friendship_id: str,
    current_user_id: UUID = Depends(get_current_user),
    service: FriendshipService = Depends(get_friendship_service),
):
    await service.delete_friendship(
        current_user_id,
        friendship_id
    )

    return {"status":"ok"}

# consultar el estado de una solicitud.
# @router.get("/status", status_code=201) 
#@router.get("/blocked",status_code=201)