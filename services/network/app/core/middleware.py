from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import Settings
from app.core.security import InvalidTokenError, decode_access_token


class JWTAuthMiddleware(BaseHTTPMiddleware):
    """
    Exige un JWT válido en Authorization: Bearer <token> para las rutas
    protegidas. El gateway reenvía el token y este servicio lo verifica por su
    cuenta; el usuario autenticado queda en request.state.user_id.
    """

    def __init__(self, app, settings: Settings):
        super().__init__(app)
        self.settings = settings

    async def dispatch(self, request: Request, call_next):
        # Salud y preflight CORS son públicos.
        if request.method == "OPTIONS" or request.url.path in ("/", "/health"):
            return await call_next(request)

        # GraphiQL (GET con Accept: text/html) es solo la interfaz; las
        # consultas GraphQL reales siguen exigiendo JWT. Una consulta enviada
        # por GET (query/operationName/extensions) no es la interfaz y se
        # protege igual que un POST.
        is_graphiql_html = (
            request.method == "GET"
            and request.url.path == "/graphql"
            and "text/html" in request.headers.get("accept", "")
            and not any(
                request.query_params.get(param)
                for param in ("query", "operationName", "extensions")
            )
        )
        if is_graphiql_html:
            return await call_next(request)

        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return JSONResponse(
                {"message": "Falta el encabezado Authorization: Bearer <token>."},
                status_code=401,
            )

        token = header.removeprefix("Bearer ").strip()
        if not token:
            return JSONResponse(
                {"message": "Falta el encabezado Authorization: Bearer <token>."},
                status_code=401,
            )

        try:
            request.state.user_id = decode_access_token(self.settings, token)
        except InvalidTokenError as exc:
            return JSONResponse({"message": str(exc)}, status_code=401)

        return await call_next(request)
