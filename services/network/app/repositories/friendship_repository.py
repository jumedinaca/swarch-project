from datetime import datetime, timezone

from bson import ObjectId
from pymongo import ASCENDING, DESCENDING, AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection


from app.models.friendship import Friendship, FriendshipStatus


class FriendshipRepository:
    def __init__(self, collection: AsyncCollection):
        self.collection = collection

    @staticmethod
    def _to_model(document: dict) -> Friendship:
        return Friendship(
            id=str(document["_id"]),
            user_a=str(document["user_a"]),
            user_b=str(document["user_b"]),
            status=FriendshipStatus(document["status"]),
            requested_by=str(document["requested_by"]),
            created_at=document["created_at"],
            updated_at=document["updated_at"],
        )

    async def create(
        self,
        user_a: str,
        user_b: str,
        requested_by: str,
    ) -> Friendship:
        now = datetime.now(timezone.utc)

        document = {
            "user_a": user_a,
            "user_b": user_b,
            "status": FriendshipStatus.PENDING.value,
            "requested_by": requested_by,
            "created_at": now,
            "updated_at": now,
        }

        result = await self.collection.insert_one(document)
        document["_id"] = result.inserted_id

        return self._to_model(document)

    async def get_by_id(self, friendship_id: str) -> Friendship | None:
        if not ObjectId.is_valid(friendship_id):
            return None

        document = await self.collection.find_one(
            {"_id": ObjectId(friendship_id)}
        )

        if document is None:
            return None

        return self._to_model(document)

    async def get_by_pair(
        self,
        user_a: str,
        user_b: str,
    ) -> Friendship | None:
        # El orden de los usuarios no importa para la búsqueda.
        document = await self.collection.find_one({
            "$or": [
                {"user_a": user_a, "user_b": user_b},
                {"user_a": user_b, "user_b": user_a},
            ]
        })

        if document is None:
            return None

        return self._to_model(document)

    async def list_for_user(
        self,
        user_id: str,
        status: FriendshipStatus | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> list[Friendship]:
        query: dict = {
            "$or": [
                {"user_a": user_id},
                {"user_b": user_id},
            ]
        }

        if status is not None:
            query["status"] = status.value

        if cursor is not None:
            if not ObjectId.is_valid(cursor):
                raise ValueError("Invalid pagination cursor")

            query["_id"] = {"$gt": ObjectId(cursor)}

        documents = await (
            self.collection
            .find(query)
            .sort("_id", ASCENDING)
            .limit(limit)
            .to_list(length=limit)
        )

        return [self._to_model(doc) for doc in documents]

    async def update_status(
        self,
        friendship_id: str,
        expected_status: FriendshipStatus,
        new_status: FriendshipStatus,
    ) -> Friendship | None:
        if not ObjectId.is_valid(friendship_id):
            return None

        now = datetime.now(timezone.utc)

        document = await self.collection.find_one_and_update(
            {
                "_id": ObjectId(friendship_id),
                "status": expected_status.value,
            },
            {
                "$set": {
                    "status": new_status.value,
                    "updated_at": now,
                }
            },
            return_document=True,
        )

        if document is None:
            return None

        return self._to_model(document)

    async def delete_pending(
        self,
        friendship_id: str,
    ) -> bool:
        if not ObjectId.is_valid(friendship_id):
            return False

        result = await self.collection.delete_one({
            "_id": ObjectId(friendship_id),
            "status": FriendshipStatus.PENDING.value,
        })

        return result.deleted_count == 1

    async def delete_by_id(
        self,
        friendship_id: str,
    ) -> bool:
        if not ObjectId.is_valid(friendship_id):
            return False

        result = await self.collection.delete_one({
            "_id": ObjectId(friendship_id),
        })   

        return result.deleted_count == 1

