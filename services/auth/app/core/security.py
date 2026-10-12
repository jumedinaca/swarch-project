import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import Settings

_hasher = PasswordHasher()

# Hash usado cuando el usuario no existe, para que el tiempo de respuesta
# no revele si un usuario está registrado (evita enumeración por timing).
_DUMMY_HASH = _hasher.hash("geopicto-dummy-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def _safe_verify(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def verify_password(password_hash: str | None, password: str) -> bool:
    if password_hash is None:
        _safe_verify(_DUMMY_HASH, password)
        return False
    return _safe_verify(password_hash, password)


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ==========================================
# Access token (JWT)
# ==========================================

@dataclass(frozen=True)
class AccessTokenClaims:
    user_id: uuid.UUID
    session_id: uuid.UUID
    username: str
    expires_at: datetime


class InvalidTokenError(Exception):
    pass


def create_access_token(
    settings: Settings,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    username: str,
) -> tuple[str, int]:
    now = utcnow()
    expires_in = settings.access_token_expire_minutes * 60
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "username": username,
        "type": "access",
        "iss": settings.jwt_issuer,
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expires_in


def decode_access_token(settings: Settings, token: str) -> AccessTokenClaims:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            issuer=settings.jwt_issuer,
            leeway=settings.jwt_leeway_seconds,
            options={"require": ["sub", "sid", "exp", "iat", "iss", "type"]},
        )
        if payload.get("type") != "access":
            raise InvalidTokenError("Tipo de token inválido")
        return AccessTokenClaims(
            user_id=uuid.UUID(payload["sub"]),
            session_id=uuid.UUID(payload["sid"]),
            username=payload.get("username", ""),
            expires_at=datetime.fromtimestamp(payload["exp"], tz=timezone.utc),
        )
    except jwt.ExpiredSignatureError as exc:
        raise InvalidTokenError("El token ha expirado") from exc
    except (jwt.PyJWTError, ValueError, KeyError) as exc:
        raise InvalidTokenError("Token inválido") from exc


# ==========================================
# Refresh token (opaco, rotativo)
# Formato: "<session_id>.<secreto aleatorio>". En BD solo se guarda el SHA-256 del secreto.
# ==========================================

def create_refresh_token(session_id: uuid.UUID) -> tuple[str, str]:
    secret = secrets.token_urlsafe(48)
    return f"{session_id}.{secret}", hash_refresh_secret(secret)


def hash_refresh_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def parse_refresh_token(token: str) -> tuple[uuid.UUID, str]:
    try:
        session_part, secret = token.split(".", 1)
        return uuid.UUID(session_part), secret
    except ValueError as exc:
        raise InvalidTokenError("Refresh token inválido") from exc


def refresh_secret_matches(secret: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_refresh_secret(secret), stored_hash)
