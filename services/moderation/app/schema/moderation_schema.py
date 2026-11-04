from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class ModerateRequest(CamelModel):
    message_id: UUID
    author_id: UUID
    content: str = Field(min_length=1, max_length=10_000)
    message_version: int = Field(default=1, ge=1)


class DecisionResponse(CamelModel):
    message_id: UUID
    message_version: int
    decision: str
    confidence: float | None
    reasons: list[str]
    model_version: str | None
    rule_version: str
    degraded: bool
    latency_ms: int | None
    decided_at: datetime | None = None
