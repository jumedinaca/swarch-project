
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.friendship import FriendshipStatus


class FriendshipCreate(BaseModel):
    recipient_id: UUID


class FriendshipResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_a: UUID
    user_b: UUID
    status: FriendshipStatus
    requested_by: UUID
    created_at: datetime
    updated_at: datetime


class FriendshipListResponse(BaseModel):
    friendships: list[FriendshipResponse]


class FriendshipListQuery(BaseModel):
    status: FriendshipStatus | None = None
    limit: int = Field(default=20, ge=1, le=100)
    cursor: str | None = None
