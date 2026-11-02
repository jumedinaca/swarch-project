from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.service.profile_service import ProfileError

# Mensajes legibles para el usuario final (el frontend muestra `message` tal cual)
FIELD_MESSAGES = {
    "displayName": "El nombre visible debe tener entre 1 y 50 caracteres, sin caracteres de control.",
    "about": "La descripción no puede superar 500 caracteres.",
    "color": "El color debe tener el formato #RRGGBB.",
    "file": "Adjunta la imagen en el campo 'file' (multipart/form-data).",
    "ids": "Envía entre 1 y 100 ids de usuario válidos separados por coma.",
    "q": "La búsqueda debe tener entre 1 y 50 caracteres.",
    "limit": "El límite debe estar entre 1 y 50.",
    "user_id": "El id de usuario no es válido.",
}

READ_ONLY_FIELDS = {"username", "email"}


def error_body(code: str, message: str, details=None) -> dict:
    body = {"error": code, "message": message}
    if details is not None:
        body["details"] = details
    return body


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ProfileError)
    async def handle_profile_error(_: Request, exc: ProfileError):
        headers = dict(exc.headers or {})
        if exc.status_code == 401:
            headers["WWW-Authenticate"] = "Bearer"
        return JSONResponse(error_body(exc.code, exc.message), exc.status_code, headers=headers or None)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError):
        errors = exc.errors()
        message = "La solicitud no es válida."
        if errors:
            first = errors[0]
            loc = first.get("loc", ())
            field = str(loc[-1]) if loc else None
            if (loc and loc[0] == "body" and len(loc) == 1) or first.get("type") == "json_invalid":
                message = "El cuerpo de la solicitud debe ser un JSON válido."
            elif first.get("type") == "extra_forbidden":
                message = (
                    "El username y el email se gestionan en el servicio de autenticación."
                    if field in READ_ONLY_FIELDS
                    else f"El campo '{field}' no se puede modificar."
                )
            else:
                message = FIELD_MESSAGES.get(field, message)
        details = [{"field": ".".join(map(str, e.get("loc", ())[1:])), "detail": e.get("msg")} for e in errors]
        return JSONResponse(error_body("validation_error", message, details), 422)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_: Request, exc: StarletteHTTPException):
        code = "not_found" if exc.status_code == 404 else "http_error"
        return JSONResponse(error_body(code, str(exc.detail)), exc.status_code, headers=exc.headers)
