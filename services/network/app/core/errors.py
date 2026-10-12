from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

# Los errores de negocio viajan dentro de la respuesta GraphQL (errors[].extensions.code,
# ver app/gql/schema.py). Aquí solo se formatean los errores HTTP, como el 401 por falta
# de X-User-ID, con el formato {"message": "..."} que lee el apiClient del frontend.


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_: Request, exc: StarletteHTTPException):
        return JSONResponse({"message": str(exc.detail)}, exc.status_code, headers=exc.headers)
