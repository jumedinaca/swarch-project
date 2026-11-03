import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

DECISIONS = ("ALLOW", "WARN", "BLOCK", "REVIEW")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class ModerationDecision(Base):
    """Auditoría de cada decisión. Nunca guarda el contenido del mensaje."""

    __tablename__ = "moderation_decisions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    message_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    author_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    decision: Mapped[str] = mapped_column(String(16), nullable=False)
    confidence: Mapped[float | None] = mapped_column(Numeric(5, 4, asdecimal=False))
    # JSONB en PostgreSQL; JSON en SQLite para las pruebas.
    reasons: Mapped[list[str]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=False, default=list
    )
    model_version: Mapped[str | None] = mapped_column(String(64))
    rule_version: Mapped[str] = mapped_column(String(32), nullable=False)
    degraded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )

    __table_args__ = (
        # Idempotencia: un mismo evento reentregado no crea otra decisión.
        UniqueConstraint("message_id", "message_version", name="uq_moderation_message_version"),
        CheckConstraint(f"decision IN {DECISIONS}", name="ck_moderation_decision"),
        Index("idx_moderation_author_created", "author_id", created_at.desc()),
    )
