from datetime import datetime, timezone
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class EventModel(BaseModel):
    """Sobre de eventos en camelCase, como lo consumen profile y email."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class UserRegisteredPayload(EventModel):
    user_id: UUID
    username: str
    email: str
    registered_at: datetime


class UserRegisteredEvent(EventModel):
    event_id: UUID = Field(default_factory=uuid4)
    event_type: str = "user.registered.v1"
    version: int = 1
    occurred_at: datetime = Field(default_factory=utcnow)
    producer: str = "auth"
    correlation_id: UUID = Field(default_factory=uuid4)
    causation_id: UUID | None = None
    payload: UserRegisteredPayload
