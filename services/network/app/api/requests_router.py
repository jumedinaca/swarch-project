from uuid import UUID

from fastapi import APIRouter, Depends

from app.core.depends import get_current_user, get_request_service_service
from app.schemas.friendship import FriendshipCreate, FriendshipResponse, FriendshipListQuery, FriendshipListResponse
from app.services import RequestService
from app.models.friendship import FriendshipStatus

router = APIRouter(prefix="/request", tags=["Requests"])

@router.post("", response_model=FriendshipResponse, status_code=201)
async def create_friendship(
    body: FriendshipCreate,
    current_user_id: UUID = Depends(get_current_user),
    service: RequestService = Depends(get_request_service_service),
):
    return await service.create_request(
        requester_id=current_user_id,
        recipient_id=body.recipient_id,
    )

@router.delete("/cancel/{friendship_id}",status_code=204)
async def cancel_friendship(
    friendship_id: str,
    current_user_id: UUID = Depends(get_current_user),
    service: RequestService = Depends(get_request_service_service),
):
    await service.cancel_request(
        friendship_id,
        current_user_id
    )

@router.get("/outcoming",response_model=FriendshipListResponse)
async def get_outcoming(
    query: FriendshipListQuery = Depends(),
    current_user_id: UUID = Depends(get_current_user),
    service: RequestService = Depends(get_request_service_service),
):
    friendships = await service.list_for_user(
        user_id=current_user_id,
        requested_from_user=True,
        status=FriendshipStatus.PENDING,
        limit=query.limit,
        cursor=query.cursor,
    )
    return FriendshipListResponse(friendships=friendships)

@router.get("/incoming",response_model=FriendshipListResponse)
async def get_incoming(
    query: FriendshipListQuery = Depends(),
    current_user_id: UUID = Depends(get_current_user),
    service: RequestService = Depends(get_request_service_service),
):
    friendships = await service.list_for_user(
        user_id=current_user_id,
        requested_from_user=False,
        status=FriendshipStatus.PENDING,
        limit=query.limit,
        cursor=query.cursor,
    )
    return FriendshipListResponse(friendships=friendships)

@router.post("/accept/{friendship_id}", response_model=FriendshipResponse)
async def accept_friendship(
    friendship_id: str,
    current_user_id: UUID = Depends(get_current_user),
    service: RequestService = Depends(get_request_service_service),
):
    return await service.accept_request(
        friendship_id,
        current_user_id
    )

@router.delete("/reject/{friendship_id}", status_code=204)
async def reject_friendship(
    friendship_id: str,
    current_user_id: UUID = Depends(get_current_user),
    service: RequestService = Depends(get_request_service_service),
):
    await service.reject_request(
        friendship_id,
        current_user_id
    )


@router.get("/{friendship_id}", response_model=FriendshipResponse)
async def get_friendship(
    friendship_id: str,
    current_user_id: UUID = Depends(get_current_user),
    service: RequestService = Depends(get_request_service_service),
):
    return await service.get_frienship_by_id(
        current_user_id,
        friendship_id
    )