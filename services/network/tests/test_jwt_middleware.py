import time
from uuid import uuid4

import jwt
import pytest
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from app.core.config import Settings
from app.core.middleware import JWTAuthMiddleware
from app.core.security import InvalidTokenError, decode_access_token

SECRET = "test-secret-for-network-jwt-middleware-0123456789"
ISSUER = "geopicto-auth"


@pytest.fixture
def settings() -> Settings:
    return Settings(JWT_SECRET=SECRET, JWT_ISSUER=ISSUER)


def make_token(subject: str, *, issuer: str = ISSUER, expires_in: int = 3600) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": subject,
            "iss": issuer,
            "iat": now,
            "exp": now + expires_in,
        },
        SECRET,
        algorithm="HS256",
    )


def make_client(settings: Settings) -> TestClient:
    async def me(request):
        return JSONResponse({"userId": str(request.state.user_id)})

    async def health(_request):
        return JSONResponse({"status": "ok"})

    async def graphql(request):
        return JSONResponse({"executed": True})

    app = Starlette(
        routes=[
            Route("/graphql", me, methods=["POST"]),
            Route("/graphql", graphql, methods=["GET"]),
            Route("/", health, methods=["GET"]),
        ]
    )
    app.add_middleware(JWTAuthMiddleware, settings=settings)
    return TestClient(app)


def test_middleware_rejects_missing_token(settings: Settings) -> None:
    response = make_client(settings).post("/graphql")
    assert response.status_code == 401
    assert "Authorization" in response.json()["message"]


def test_middleware_rejects_invalid_token(settings: Settings) -> None:
    response = make_client(settings).post(
        "/graphql", headers={"Authorization": "Bearer not-a-jwt"}
    )
    assert response.status_code == 401


def test_middleware_accepts_valid_token(settings: Settings) -> None:
    user_id = uuid4()
    response = make_client(settings).post(
        "/graphql", headers={"Authorization": f"Bearer {make_token(str(user_id))}"}
    )
    assert response.status_code == 200
    assert response.json()["userId"] == str(user_id)


def test_middleware_keeps_health_public(settings: Settings) -> None:
    response = make_client(settings).get("/")
    assert response.status_code == 200


def test_middleware_keeps_graphiql_html_public(settings: Settings) -> None:
    response = make_client(settings).get(
        "/graphql", headers={"Accept": "text/html"}
    )
    assert response.status_code == 200


def test_middleware_protects_get_queries(settings: Settings) -> None:
    response = make_client(settings).get(
        "/graphql",
        params={"query": "{ friends { id } }"},
        headers={"Accept": "text/html"},
    )
    assert response.status_code == 401


def test_decode_rejects_expired_token(settings: Settings) -> None:
    token = make_token(str(uuid4()), expires_in=-60)
    with pytest.raises(InvalidTokenError):
        decode_access_token(settings, token)


def test_decode_rejects_other_issuer(settings: Settings) -> None:
    token = make_token(str(uuid4()), issuer="someone-else")
    with pytest.raises(InvalidTokenError):
        decode_access_token(settings, token)
