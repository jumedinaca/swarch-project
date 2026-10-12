from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.service.auth_service import AuthError

# Mensajes legibles para el usuario final (el frontend muestra `message` tal cual)
FIELD_MESSAGES = {
    "username": "El nombre de usuario debe tener entre 3 y 30 caracteres (letras, números, '.', '_' o '-').",
    "email": "Ingresa un correo electrónico válido.",
    "password": "La contraseña debe tener entre 8 y 128 caracteres.",
    "newPassword": "La nueva contraseña debe tener entre 8 y 128 caracteres.",
    "usernameOrEmail": "Ingresa tu nombre de usuario o correo.",
    "currentPassword": "Ingresa tu contraseña actual.",
    "refreshToken": "Falta el refresh token.",
    "color": "El color debe tener formato hexadecimal (#RRGGBB).",
}


def error_body(code: str, message: str, details=None) -> dict:
    body = {"success": False, "error": code, "message": message}
    if details is not None:
        body["details"] = details
    return body


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AuthError)
    async def handle_auth_error(_: Request, exc: AuthError):
        headers = {"WWW-Authenticate": "Bearer"} if exc.status_code == 401 else None
        return JSONResponse(error_body(exc.code, exc.message), exc.status_code, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError):
        errors = exc.errors()
        message = "La solicitud no es válida."
        if errors:
            loc = errors[0].get("loc", ())
            field = loc[-1] if loc else None
            if (loc and loc[0] == "body" and len(loc) == 1) or errors[0].get("type") == "json_invalid":
                message = "El cuerpo de la solicitud debe ser un JSON válido."
            elif field == "password" and errors[0].get("type") == "missing":
                message = "Ingresa una contraseña."
            else:
                message = FIELD_MESSAGES.get(str(field), message)
        details = [{"field": ".".join(map(str, e.get("loc", ())[1:])), "detail": e.get("msg")} for e in errors]
        return JSONResponse(error_body("validation_error", message, details), 422)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_: Request, exc: StarletteHTTPException):
        return JSONResponse(error_body("http_error", str(exc.detail)), exc.status_code)
