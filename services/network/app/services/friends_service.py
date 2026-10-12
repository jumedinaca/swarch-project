"""
Service for handling user friends queries
"""
from uuid import UUID

from app.models import Friendship, FriendshipStatus, friendship
from app.repositories.friendship_repository import FriendshipRepository


class FriendsService():
    def __init__(self, repository: FriendshipRepository):
        self.repository = repository

    
    async def get_friends(
        self,
        user_id: UUID,
        limit: int,
        cursor: str | None,
    ) -> list[Friendship]:
        
        return await self.repository.list_for_user(
            user_id=str(user_id),
            is_requested_by_user=None,
            status=FriendshipStatus.ACCEPTED,
            limit=limit,
            cursor=cursor
        )
    

    async def delete_friend(
        self,
        user_id: UUID,
        user_del_id: UUID,
    ):
        friendship = await self.repository.get_by_pair(
            user_a=str(user_id),
            user_b=str(user_del_id)
        )

        if not friendship:
            raise Exception #########

        if friendship.status != FriendshipStatus.ACCEPTED:
            raise Exception

        await self.repository.delete_by_id(
            friendship_id=friendship.id
        )
        