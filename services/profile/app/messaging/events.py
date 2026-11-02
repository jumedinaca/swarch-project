from datetime import datetime, timezone
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class EventModel(BaseModel):
    """Sobre común de eventos en camelCase (ver services/auth/README_P2.md)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


# ==========================================
# Consumidos (los publica auth)
# ==========================================

class UserRegisteredPayload(EventModel):
    user_id: UUID
    username: str


class UserUpdatedPayload(EventModel):
    user_id: UUID
    username: str


class UserDeletedPayload(EventModel):
    user_id: UUID


# ==========================================
# Publicados
# ==========================================

class ProfileUpdatedPayload(EventModel):
    user_id: UUID
    changed_fields: list[str]
    display_name: str | None
    avatar_url: str | None
    color: str
    updated_at: datetime


class ProfileUpdatedEvent(EventModel):
    event_id: UUID = Field(default_factory=uuid4)
    event_type: str = "profile.updated.v1"
    version: int = 1
    occurred_at: datetime = Field(default_factory=utcnow)
    producer: str = "profile"
    correlation_id: UUID = Field(default_factory=uuid4)
    causation_id: UUID | None = None
    payload: ProfileUpdatedPayload
