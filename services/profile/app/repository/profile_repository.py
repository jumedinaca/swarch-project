import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models import Profile


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class ProfileRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get(self, user_id: uuid.UUID) -> Profile | None:
        return await self.db.get(Profile, user_id)

    async def get_many(self, user_ids: list[uuid.UUID]) -> list[Profile]:
        if not user_ids:
            return []
        stmt = select(Profile).where(Profile.user_id.in_(user_ids))
        return list((await self.db.execute(stmt)).scalars().all())

    async def search(self, query: str, limit: int) -> list[Profile]:
        pattern = f"%{_escape_like(query.lower())}%"
        stmt = (
            select(Profile)
            .where(
                or_(
                    func.lower(Profile.display_name).like(pattern, escape="\\"),
                    func.lower(Profile.username).like(pattern, escape="\\"),
                )
            )
            .order_by(func.lower(Profile.username))
            .limit(limit)
        )
        return list((await self.db.execute(stmt)).scalars().all())

    def add(self, profile: Profile) -> None:
        self.db.add(profile)

    async def delete(self, profile: Profile) -> None:
        await self.db.delete(profile)
