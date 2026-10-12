import uuid
from datetime import datetime

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models import Session, User


class UserRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        return await self.db.get(User, user_id)

    async def get_by_username_or_email(self, identifier: str) -> User | None:
        value = identifier.strip().lower()
        stmt = select(User).where(
            or_(func.lower(User.username) == value, func.lower(User.email) == value)
        )
        return (await self.db.execute(stmt)).scalars().first()

    async def username_exists(self, username: str) -> bool:
        stmt = select(User.id).where(func.lower(User.username) == username.lower())
        return (await self.db.execute(stmt)).first() is not None

    async def email_exists(self, email: str) -> bool:
        stmt = select(User.id).where(func.lower(User.email) == email.lower())
        return (await self.db.execute(stmt)).first() is not None

    async def count(self) -> int:
        return (await self.db.execute(select(func.count(User.id)))).scalar_one()

    def add(self, user: User) -> None:
        self.db.add(user)


class SessionRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get(self, session_id: uuid.UUID) -> Session | None:
        return await self.db.get(Session, session_id)

    async def get_with_user(self, session_id: uuid.UUID) -> tuple[Session, User] | None:
        stmt = (
            select(Session, User)
            .join(User, User.id == Session.user_id)
            .where(Session.id == session_id)
        )
        row = (await self.db.execute(stmt)).first()
        return (row[0], row[1]) if row else None

    async def list_active(self, user_id: uuid.UUID, now: datetime) -> list[Session]:
        stmt = (
            select(Session)
            .where(
                Session.user_id == user_id,
                Session.revoked_at.is_(None),
                Session.expires_at > now,
            )
            .order_by(Session.created_at.desc())
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def revoke_all(
        self, user_id: uuid.UUID, now: datetime, except_session: uuid.UUID | None = None
    ) -> int:
        stmt = (
            update(Session)
            .where(Session.user_id == user_id, Session.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        if except_session is not None:
            stmt = stmt.where(Session.id != except_session)
        result = await self.db.execute(stmt)
        return result.rowcount or 0

    def add(self, session: Session) -> None:
        self.db.add(session)
