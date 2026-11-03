import uuid
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models import EmailLog, utcnow


class EmailRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_id(self, email_id: uuid.UUID) -> EmailLog | None:
        return await self.session.get(EmailLog, email_id)

    async def get_by_idempotency_key(self, idempotency_key: str) -> EmailLog | None:
        stmt = select(EmailLog).where(EmailLog.idempotency_key == idempotency_key)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def create_or_get(
        self,
        *,
        email_id: uuid.UUID,
        idempotency_key: str,
        recipient: str,
        template: str,
        subject: str,
        initial_status: str = "QUEUED",
        last_error: str | None = None,
    ) -> tuple[EmailLog, bool]:
        """
        Inserta un registro en `email_log` de forma idempotente.
        Devuelve `(registro, creado)`. Si ya existía por `idempotency_key` o `id`, devuelve `(existente, False)`.
        """
        existing = await self.get_by_idempotency_key(idempotency_key)
        if existing is not None:
            return existing, False

        existing_by_id = await self.get_by_id(email_id)
        if existing_by_id is not None:
            return existing_by_id, False

        now = utcnow()
        row = EmailLog(
            id=email_id,
            idempotency_key=idempotency_key,
            recipient=recipient,
            template=template,
            subject=subject,
            status=initial_status,
            attempts=0,
            last_error=last_error,
            created_at=now,
            updated_at=now,
        )
        self.session.add(row)
        try:
            await self.session.commit()
            return row, True
        except IntegrityError:
            await self.session.rollback()
            raced = await self.get_by_idempotency_key(idempotency_key)
            if raced is not None:
                return raced, False
            raced_by_id = await self.get_by_id(email_id)
            if raced_by_id is not None:
                return raced_by_id, False
            raise

    async def mark_sending(self, row: EmailLog) -> EmailLog:
        row.status = "SENDING"
        row.attempts = (row.attempts or 0) + 1
        row.updated_at = utcnow()
        await self.session.commit()
        return row

    async def mark_sent(self, row: EmailLog, provider_message_id: str | None) -> EmailLog:
        now = utcnow()
        row.status = "SENT"
        row.provider_message_id = provider_message_id
        row.last_error = None
        row.sent_at = now
        row.updated_at = now
        await self.session.commit()
        return row

    async def mark_retry_queued(self, row: EmailLog, sanitized_error: str) -> EmailLog:
        row.status = "QUEUED"
        row.last_error = sanitized_error
        row.updated_at = utcnow()
        await self.session.commit()
        return row

    async def mark_terminal_failure(self, row: EmailLog, sanitized_error: str, *, dlq: bool) -> EmailLog:
        row.status = "DLQ" if dlq else "FAILED"
        row.last_error = sanitized_error
        row.updated_at = utcnow()
        await self.session.commit()
        return row

    async def count_recent_to_recipient(self, recipient: str, window_seconds: int = 3600) -> int:
        cutoff = utcnow() - timedelta(seconds=window_seconds)
        stmt = (
            select(func.count())
            .select_from(EmailLog)
            .where(
                EmailLog.recipient == recipient,
                EmailLog.status.in_(("SENT", "SENDING")),
                EmailLog.updated_at >= cutoff,
            )
        )
        result = await self.session.execute(stmt)
        return int(result.scalar_one() or 0)

    async def purge_expired(self, retention_days: int) -> int:
        cutoff = utcnow() - timedelta(days=retention_days)
        stmt = delete(EmailLog).where(EmailLog.created_at < cutoff)
        result = await self.session.execute(stmt)
        await self.session.commit()
        return int(result.rowcount or 0)
