import uuid
from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from pydantic.alias_generators import to_camel

T = TypeVar("T")


class CamelModel(BaseModel):
    """El frontend (TypeScript) trabaja en camelCase."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


# ==========================================
# Requests
# ==========================================

USERNAME_PATTERN = r"^[\w.-]+$"


class RegisterRequest(CamelModel):
    username: str = Field(min_length=3, max_length=30, pattern=USERNAME_PATTERN)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(CamelModel):
    username_or_email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(CamelModel):
    refresh_token: str = Field(min_length=1)


class ChangePasswordRequest(CamelModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# ==========================================
# Responses
# ==========================================

class UserOut(CamelModel):
    id: uuid.UUID
    username: str
    email: str
    is_active: bool
    created_at: datetime


class AuthData(CamelModel):
    user: UserOut
    token: str
    refresh_token: str
    token_type: str = "Bearer"
    expires_in: int


class SessionOut(CamelModel):
    id: uuid.UUID
    user_agent: str | None
    ip_address: str | None
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime
    current: bool = False


class Envelope(CamelModel, Generic[T]):
    """Formato { success, data, message } que espera apiClient.ts del frontend."""

    success: bool = True
    data: T | None = None
    message: str | None = None
