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
# Consumidos (los publica messages)
# ==========================================

class MessageSubmittedPayload(EventModel):
    """Payload de message.submitted.v1 y message.edited.v1."""

    message_id: UUID
    author_id: UUID
    content: str
    message_version: int = 1


class IncomingEvent(EventModel):
    event_id: UUID
    correlation_id: UUID | None = None
    payload: MessageSubmittedPayload


# ==========================================
# Publicados
# ==========================================

class ModerationCompletedPayload(EventModel):
    message_id: UUID
    author_id: UUID
    message_version: int
    decision: str
    confidence: float | None
    reasons: list[str]
    model_version: str | None
    rule_version: str
    degraded: bool
    decided_at: datetime


class ModerationFailedPayload(EventModel):
    message_id: UUID
    author_id: UUID
    message_version: int
    reason: str
    failed_at: datetime = Field(default_factory=utcnow)


class _Envelope(EventModel):
    event_id: UUID = Field(default_factory=uuid4)
    version: int = 1
    occurred_at: datetime = Field(default_factory=utcnow)
    producer: str = "moderation"
    correlation_id: UUID = Field(default_factory=uuid4)
    causation_id: UUID | None = None


class ModerationCompletedEvent(_Envelope):
    event_type: str = "moderation.completed.v1"
    payload: ModerationCompletedPayload


class ModerationFailedEvent(_Envelope):
    event_type: str = "moderation.failed.v1"
    payload: ModerationFailedPayload
