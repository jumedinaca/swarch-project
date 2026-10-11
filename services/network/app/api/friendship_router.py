import re
from uuid import UUID

from fastapi import APIRouter, Depends

from app.core.depends import get_current_user, get_friendship_service
from app.schemas.friendship import FriendshipCreate, FriendshipResponse, FriendshipListQuery, FriendshipListResponse
from app.services.friendship_service import FriendshipService


router = APIRouter(prefix="/friendships", tags=["Friendships"])

@router.get("", response_model=FriendshipListResponse, status_code=201)
async def get_frienships(
    body: FriendshipListQuery,
    current_user_id: UUID = Depends(get_current_user),
    service: FriendshipService = Depends(get_friendship_service),
):
    return await service.list_for_user(
        user_id=current_user_id,
        status=body.status,
        limit=body.limit,
        cursor=body.cursor,
    )

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

@router.delete("/{friendship_id}",status_code=201)
async def delete_friendship(
    friendship_id: str,
    service: FriendshipService = Depends(get_friendship_service),
):
    await service.delete_friendship(
        friendship_id
    )

    return {"status":"ok"}

#@router.get("/incoming",status_code=201)