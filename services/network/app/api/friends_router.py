from uuid import UUID

from fastapi import APIRouter, Depends

from app.core.depends import get_current_user, get_friends_service
from app.schemas.friendship import FriendshipListQuery, FriendshipListResponse
from app.services import FriendsService
from app.models.friendship import Friendship

r = APIRouter(prefix="/friends", tags=["Friends"])

@r.get("",response_model=FriendshipListResponse)
async def get_friends(
    current_user_id: UUID   = Depends(get_current_user),
    query: FriendshipListQuery = Depends(),
    service: FriendsService = Depends(get_friends_service)
):
    return service.get_friends(
        current_user_id,
        limit=query.limit,
        cursor=query.cursor
        )

@r.delete("/{friend_id}",status_code=201)
async def delete_friend(
    friend_id: UUID,
    current_user_id: UUID   = Depends(get_current_user),
    service: FriendsService = Depends(get_friends_service)
):
    await service.delete_friend(
        current_user_id,
        friend_id
    )

### To do for future
# @r.get("")
# async def is_my_friend():
#     pass

# @r.get("")
# async def count():
#     pass

# @r.get("")
# async def get_mutual_friends():
#     pass