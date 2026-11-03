import uuid
from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, String, Text, Uuid, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

EMAIL_STATUSES = ("QUEUED", "SENDING", "SENT", "FAILED", "DLQ")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class EmailLog(Base):
    """Registro transaccional y de auditoría de envíos de correo."""

    __tablename__ = "email_log"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    idempotency_key: Mapped[str | None] = mapped_column(String(160), unique=True)
    recipient: Mapped[str] = mapped_column(String(320), nullable=False)
    template: Mapped[str] = mapped_column(String(64), nullable=False)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="QUEUED", server_default="QUEUED")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    provider_message_id: Mapped[str | None] = mapped_column(String(255))
    last_error: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "status IN ('QUEUED','SENDING','SENT','FAILED','DLQ')",
            name="ck_email_log_status",
        ),
        Index("idx_email_log_status_created", "status", "created_at"),
        Index("idx_email_log_recipient_created", "recipient", "created_at"),
    )
