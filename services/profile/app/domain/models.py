import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Index, String, Text, Uuid, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Profile(Base):
    """Datos públicos del usuario. Identidad, email y contraseña viven en auth."""

    __tablename__ = "profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    # Copia del username de auth, actualizada con user.updated.v1. No se edita aquí.
    username: Mapped[str] = mapped_column(String(50), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(50))
    about: Mapped[str | None] = mapped_column(String(500))
    color: Mapped[str] = mapped_column(String(7), nullable=False, server_default="#2AC769")
    # Ruta del objeto en MinIO; avatar_url es la URL estable que ve el cliente.
    avatar_key: Mapped[str | None] = mapped_column(Text)
    avatar_url: Mapped[str | None] = mapped_column(Text)

    # Se asignan desde Python para no tener que recargar la fila tras el commit.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )

    __table_args__ = (
        Index("idx_profiles_display_name", func.lower(display_name)),
        Index("idx_profiles_username", func.lower(username)),
    )
