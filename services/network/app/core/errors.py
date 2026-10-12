from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pymongo.errors import DuplicateKeyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.services.requests_service import (
    FriendshipAlreadyExistsError,
    FriendshipError,
    FriendshipNotFoundError,
    FriendshipPermissionError,
    InvalidFriendshipOperationError,
)

# Los errores de negocio se responden como {"message": "..."}, el formato que
# lee el apiClient del frontend (igual que los errores del gateway).
STATUS_BY_ERROR = {
    FriendshipNotFoundError: 404,
    FriendshipPermissionError: 403,
    FriendshipAlreadyExistsError: 409,
    InvalidFriendshipOperationError: 400,
}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(FriendshipError)
    async def handle_friendship_error(_: Request, exc: FriendshipError):
        return JSONResponse({"message": str(exc)}, STATUS_BY_ERROR.get(type(exc), 400))

    @app.exception_handler(DuplicateKeyError)
    async def handle_duplicate(_: Request, __: DuplicateKeyError):
        return JSONResponse(
            {"message": "Ya existe una relación o solicitud entre estos usuarios."}, 409
        )

    @app.exception_handler(ValueError)
    async def handle_value_error(_: Request, exc: ValueError):
        return JSONResponse({"message": str(exc)}, 400)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_: Request, exc: StarletteHTTPException):
        return JSONResponse({"message": str(exc.detail)}, exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError):
        return JSONResponse({"message": "La solicitud no es válida.", "details": jsonable_encoder(exc.errors())}, 422)
