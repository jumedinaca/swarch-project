import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models import ModerationDecision


class DecisionRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_for_version(self, message_id: uuid.UUID, message_version: int) -> ModerationDecision | None:
        stmt = select(ModerationDecision).where(
            ModerationDecision.message_id == message_id,
            ModerationDecision.message_version == message_version,
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def get_latest(self, message_id: uuid.UUID) -> ModerationDecision | None:
        stmt = (
            select(ModerationDecision)
            .where(ModerationDecision.message_id == message_id)
            .order_by(ModerationDecision.message_version.desc())
            .limit(1)
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def count_by_decision_since(self, author_id: uuid.UUID, since: datetime) -> dict[str, int]:
        stmt = (
            select(ModerationDecision.decision, func.count())
            .where(ModerationDecision.author_id == author_id, ModerationDecision.created_at >= since)
            .group_by(ModerationDecision.decision)
        )
        return {decision: count for decision, count in (await self.db.execute(stmt)).all()}

    def add(self, decision: ModerationDecision) -> None:
        self.db.add(decision)
