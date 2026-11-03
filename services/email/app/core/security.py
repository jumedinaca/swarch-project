import hmac

from fastapi import Header, Request


class InternalAuthError(Exception):
    def __init__(self, message: str = "Token interno inválido o ausente."):
        super().__init__(message)
        self.status_code = 401
        self.code = "unauthorized"
        self.message = message


def require_internal_token(
    request: Request,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> None:
    expected: str = request.app.state.settings.internal_token
    provided = x_internal_token or ""
    if not expected or not provided or not hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8")):
        raise InternalAuthError()
