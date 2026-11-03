from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import sanitize_error
from app.core.security import InternalAuthError
from app.service.email_service import EmailError

FIELD_MESSAGES = {
    "to": "El destinatario ('to') debe ser un correo válido de máximo 320 caracteres.",
    "template": "La plantilla solicitada no está registrada (permitidas: welcome, generic).",
    "subject": "El asunto es obligatorio y no puede superar 200 caracteres.",
    "variables": "Las variables enviadas no cumplen con el contrato de la plantilla.",
    "ctaUrl": "ctaUrl debe ser un enlace absoluto con esquema http o https.",
    "cta_url": "ctaUrl debe ser un enlace absoluto con esquema http o https.",
    "idempotencyKey": "idempotencyKey debe tener entre 1 y 160 caracteres.",
    "replyTo": "replyTo debe ser un correo electrónico válido.",
    "id": "El identificador del correo no es un UUID válido.",
}


def error_body(code: str, message: str, details=None) -> dict:
    body = {"error": code, "message": message}
    if details is not None:
        body["details"] = details
    return body


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(InternalAuthError)
    async def handle_internal_auth_error(_: Request, exc: InternalAuthError):
        return JSONResponse(error_body(exc.code, exc.message), exc.status_code)

    @app.exception_handler(EmailError)
    async def handle_email_error(_: Request, exc: EmailError):
        return JSONResponse(
            error_body(exc.code, exc.message),
            exc.status_code,
            headers=exc.headers or None,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError):
        errors = exc.errors()
        message = "La solicitud de correo no es válida."
        if errors:
            first = errors[0]
            loc = first.get("loc", ())
            field = str(loc[-1]) if loc else None
            if (loc and loc[0] == "body" and len(loc) == 1) or first.get("type") == "json_invalid":
                message = "El cuerpo de la solicitud debe ser un JSON válido."
            elif first.get("type") == "extra_forbidden":
                message = f"El campo '{field}' no está permitido."
            elif field and field in FIELD_MESSAGES:
                message = FIELD_MESSAGES[field]
            elif first.get("msg"):
                message = sanitize_error(str(first["msg"]))
        details = [
            {
                "field": ".".join(map(str, e.get("loc", ())[1:])),
                "detail": sanitize_error(str(e.get("msg", ""))),
            }
            for e in errors
        ]
        return JSONResponse(error_body("validation_error", message, details), 422)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_: Request, exc: StarletteHTTPException):
        code = "not_found" if exc.status_code == 404 else "http_error"
        return JSONResponse(error_body(code, str(exc.detail)), exc.status_code, headers=exc.headers)
