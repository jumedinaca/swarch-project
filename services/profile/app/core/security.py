import uuid
from dataclasses import dataclass

import jwt

from app.core.config import Settings


@dataclass(frozen=True)
class TokenClaims:
    user_id: uuid.UUID
    # Lo agrega auth; los tokens de scripts/dev-token.mjs no lo traen.
    username: str | None


class InvalidTokenError(Exception):
    pass


def decode_access_token(settings: Settings, token: str) -> TokenClaims:
    """
    Verifica firma, emisor, expiración y que el claim sub sea un UUID.
    Se aceptan tokens sin claim type (por ejemplo los de scripts/dev-token.mjs),
    pero si viene debe ser "access".
    """
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            issuer=settings.jwt_issuer,
            leeway=settings.jwt_leeway_seconds,
            options={"require": ["sub", "exp", "iss"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise InvalidTokenError("El token ha expirado.") from exc
    except (jwt.PyJWTError, ValueError, KeyError, TypeError) as exc:
        raise InvalidTokenError("Token inválido.") from exc

    if payload.get("type") not in (None, "", "access"):
        raise InvalidTokenError("Tipo de token inválido.")

    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, TypeError, ValueError) as exc:
        raise InvalidTokenError("Token inválido.") from exc

    username = payload.get("username")
    return TokenClaims(user_id=user_id, username=username if isinstance(username, str) and username else None)
