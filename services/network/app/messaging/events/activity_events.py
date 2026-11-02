from datetime import datetime, timezone
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class EventModel(BaseModel):
    """Sobre de eventos en camelCase, como lo consume socket-gateway."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ActivityCreatedPayload(EventModel):
    activity_id: UUID
    user_id: UUID
    actor_id: UUID
    type: str
    entity_id: str
    summary: str
    created_at: datetime = Field(default_factory=utcnow)


class ActivityCreatedEvent(EventModel):
    event_id: UUID = Field(default_factory=uuid4)
    event_type: str = "activity.created.v1"
    version: int = 1
    occurred_at: datetime = Field(default_factory=utcnow)
    producer: str = "network"
    correlation_id: UUID = Field(default_factory=uuid4)
    causation_id: UUID | None = None
    payload: ActivityCreatedPayload
