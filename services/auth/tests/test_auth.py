import uuid
from datetime import timedelta

import jwt

from app.core import security
from tests.conftest import bearer, register


async def test_register_returns_frontend_contract(client, settings):
    res = await register(client)
    assert res.status_code == 201
    body = res.json()
    assert body["success"] is True
    user = body["data"]["user"]
    uuid.UUID(user["id"])  # el servicio de mensajes exige UUID en X-User-ID
    assert user["username"] == "Explorador"
    assert user["email"] == "explorador@geochat.org"
    assert user["color"] in settings.avatar_color_list
    assert "password" not in str(user).lower()
    assert body["data"]["token"]
    assert body["data"]["refreshToken"]
    assert body["data"]["expiresIn"] == settings.access_token_expire_minutes * 60


async def test_register_rejects_duplicates_case_insensitive(client):
    await register(client)
    res = await register(client, username="EXPLORADOR", email="otro@geochat.org")
    assert res.status_code == 409
    assert res.json()["error"] == "username_taken"

    res = await register(client, username="otro", email="Explorador@GeoChat.org")
    assert res.status_code == 409
    assert res.json()["error"] == "email_taken"


async def test_register_validation_message(client):
    res = await register(client, password="corta")
    assert res.status_code == 422
    body = res.json()
    assert body["success"] is False
    assert "8" in body["message"]

    res = await client.post("/auth/register", json={"username": "abc", "email": "x@y.co"})
    assert res.json()["message"] == "Ingresa una contraseña."


async def test_login_with_username_or_email(client):
    await register(client)
    for identifier in ("explorador", "EXPLORADOR@geochat.org"):
        res = await client.post(
            "/auth/login", json={"usernameOrEmail": identifier, "password": "secreto123"}
        )
        assert res.status_code == 200, res.text
        assert res.json()["data"]["user"]["username"] == "Explorador"


async def test_login_wrong_credentials(client):
    await register(client)
    res = await client.post("/auth/login", json={"usernameOrEmail": "explorador", "password": "mala"})
    assert res.status_code == 401
    assert res.json()["message"] == "Usuario o contraseña incorrectos."

    res = await client.post("/auth/login", json={"usernameOrEmail": "nadie", "password": "mala"})
    assert res.status_code == 401


async def test_account_locks_after_failed_attempts(client):
    await register(client)
    for _ in range(3):
        await client.post("/auth/login", json={"usernameOrEmail": "explorador", "password": "mala"})
    res = await client.post(
        "/auth/login", json={"usernameOrEmail": "explorador", "password": "secreto123"}
    )
    assert res.status_code == 423
    assert res.json()["error"] == "account_locked"


async def test_profile_requires_token(client):
    token = (await register(client)).json()["data"]["token"]

    res = await client.get("/auth/profile")
    assert res.status_code == 401

    res = await client.get("/auth/profile", headers=bearer(token))
    assert res.status_code == 200
    assert res.json()["data"]["username"] == "Explorador"


async def test_update_profile_color(client):
    token = (await register(client)).json()["data"]["token"]
    res = await client.patch("/auth/profile", json={"color": "#abcdef"}, headers=bearer(token))
    assert res.status_code == 200
    assert res.json()["data"]["color"] == "#ABCDEF"

    res = await client.patch("/auth/profile", json={"color": "rojo"}, headers=bearer(token))
    assert res.status_code == 422


async def test_validate_exposes_identity_headers(client):
    data = (await register(client)).json()["data"]
    res = await client.get("/auth/validate", headers=bearer(data["token"]))
    assert res.status_code == 200
    assert res.headers["X-User-ID"] == data["user"]["id"]
    assert res.headers["X-User-Name"] == "Explorador"
    assert res.json()["data"]["userId"] == data["user"]["id"]


async def test_validate_rejects_bad_tokens(client, settings):
    data = (await register(client)).json()["data"]

    res = await client.get("/auth/validate", headers=bearer(data["token"] + "x"))
    assert res.status_code == 401

    forged = jwt.encode(
        jwt.decode(data["token"], options={"verify_signature": False}),
        "otro-secreto-otro-secreto-otro-secreto",
        algorithm="HS256",
    )
    res = await client.get("/auth/validate", headers=bearer(forged))
    assert res.status_code == 401

    claims = jwt.decode(data["token"], options={"verify_signature": False})
    claims["exp"] = security.utcnow() - timedelta(seconds=settings.jwt_leeway_seconds + 60)
    expired = jwt.encode(claims, settings.jwt_secret, algorithm="HS256")
    res = await client.get("/auth/validate", headers=bearer(expired))
    assert res.status_code == 401
    assert res.json()["message"] == "El token ha expirado"


async def test_logout_revokes_access_token(client):
    token = (await register(client)).json()["data"]["token"]
    res = await client.post("/auth/logout", headers=bearer(token))
    assert res.status_code == 200
    res = await client.get("/auth/validate", headers=bearer(token))
    assert res.status_code == 401


async def test_refresh_rotates_and_detects_reuse(client):
    data = (await register(client)).json()["data"]
    old_refresh = data["refreshToken"]

    res = await client.post("/auth/refresh", json={"refreshToken": old_refresh})
    assert res.status_code == 200
    new_refresh = res.json()["data"]["refreshToken"]
    assert new_refresh != old_refresh

    # Reusar el token viejo revoca la sesión completa
    res = await client.post("/auth/refresh", json={"refreshToken": old_refresh})
    assert res.status_code == 401
    res = await client.post("/auth/refresh", json={"refreshToken": new_refresh})
    assert res.status_code == 401


async def test_change_password_closes_other_sessions(client):
    first = (await register(client)).json()["data"]["token"]
    second = (
        await client.post(
            "/auth/login", json={"usernameOrEmail": "explorador", "password": "secreto123"}
        )
    ).json()["data"]["token"]

    res = await client.put(
        "/auth/password",
        json={"currentPassword": "secreto123", "newPassword": "nuevoSecreto456"},
        headers=bearer(first),
    )
    assert res.status_code == 200
    assert (await client.get("/auth/validate", headers=bearer(first))).status_code == 200
    assert (await client.get("/auth/validate", headers=bearer(second))).status_code == 401

    res = await client.post(
        "/auth/login", json={"usernameOrEmail": "explorador", "password": "nuevoSecreto456"}
    )
    assert res.status_code == 200


async def test_list_and_revoke_sessions(client):
    first = (await register(client)).json()["data"]["token"]
    second = (
        await client.post(
            "/auth/login", json={"usernameOrEmail": "explorador", "password": "secreto123"}
        )
    ).json()["data"]["token"]

    sessions = (await client.get("/auth/sessions", headers=bearer(first))).json()["data"]
    assert len(sessions) == 2
    assert sum(s["current"] for s in sessions) == 1

    other = next(s for s in sessions if not s["current"])
    res = await client.delete(f"/auth/sessions/{other['id']}", headers=bearer(first))
    assert res.status_code == 200
    assert (await client.get("/auth/validate", headers=bearer(second))).status_code == 401


async def test_logout_all(client):
    first = (await register(client)).json()["data"]["token"]
    await client.post("/auth/login", json={"usernameOrEmail": "explorador", "password": "secreto123"})
    res = await client.post("/auth/logout-all", headers=bearer(first))
    assert res.status_code == 200
    assert (await client.get("/auth/validate", headers=bearer(first))).status_code == 401


async def test_health(client):
    res = await client.get("/health")
    assert res.status_code == 200
