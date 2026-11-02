import unicodedata
import uuid
from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, field_validator
from pydantic.alias_generators import to_camel

from app.core.colors import COLOR_PATTERN


class CamelModel(BaseModel):
    """El frontend (TypeScript) trabaja en camelCase."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


def _has_control_chars(value: str, allowed: str = "") -> bool:
    return any(unicodedata.category(c) == "Cc" and c not in allowed for c in value)


# ==========================================
# Requests
# ==========================================

class ProfileUpdate(CamelModel):
    """
    PATCH parcial: solo se cambian los campos presentes en el cuerpo.
    `null` borra displayName/about y devuelve color al valor generado.
    """

    # username y email pertenecen a auth: enviarlos es un error, no se ignoran.
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = None
    about: str | None = None
    color: str | None = None

    @field_validator("display_name")
    @classmethod
    def check_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not 1 <= len(value) <= 50 or _has_control_chars(value):
            raise ValueError("invalid display name")
        return value

    @field_validator("about")
    @classmethod
    def check_about(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.replace("\r\n", "\n").strip()
        if len(value) > 500 or _has_control_chars(value, allowed="\n\t"):
            raise ValueError("invalid about")
        return value or None

    @field_validator("color")
    @classmethod
    def check_color(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not COLOR_PATTERN.fullmatch(value):
            raise ValueError("invalid color")
        return value.upper()


# ==========================================
# Responses (sin sobre { success, data }: se devuelve el dato directo)
# ==========================================

class ProfileOut(CamelModel):
    user_id: uuid.UUID
    username: str
    display_name: str | None
    about: str | None
    avatar_url: str | None
    color: str
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def as_utc(cls, value: datetime) -> datetime:
        # Las fechas se guardan en UTC; algunos drivers (SQLite) las devuelven sin zona.
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class AvatarOut(CamelModel):
    avatar_url: str
