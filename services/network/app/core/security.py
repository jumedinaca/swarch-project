from uuid import UUID

import jwt

from app.core.config import Settings


class InvalidTokenError(Exception):
    pass


def decode_access_token(settings: Settings, token: str) -> UUID:
    """
    Verifica firma, emisor, expiración y que el claim sub sea un UUID.
    Se aceptan tokens sin claim type (por ejemplo los de scripts/dev-token.mjs),
    pero si viene debe ser "access".
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
            issuer=settings.JWT_ISSUER,
            leeway=settings.JWT_LEEWAY_SECONDS,
            options={"require": ["sub", "exp", "iss"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise InvalidTokenError("El token ha expirado") from exc
    except (jwt.PyJWTError, ValueError, KeyError, TypeError) as exc:
        raise InvalidTokenError("Token inválido") from exc

    token_type = payload.get("type")
    if token_type not in (None, "", "access"):
        raise InvalidTokenError("Tipo de token inválido")

    try:
        return UUID(payload["sub"])
    except (KeyError, TypeError, ValueError) as exc:
        raise InvalidTokenError("Token inválido") from exc
