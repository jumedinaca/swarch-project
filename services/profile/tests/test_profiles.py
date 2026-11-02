import uuid
from datetime import timedelta

import pytest

from app.core.colors import PALETTE, default_color
from tests.conftest import auth_headers, make_token


async def create_profile(client, username="ExploradorGeo", user_id=None):
    user_id = user_id or uuid.uuid4()
    response = await client.get("/profiles/me", headers=auth_headers(user_id, username))
    assert response.status_code == 200
    return user_id, response.json()


# ==========================================
# Autenticación
# ==========================================

async def test_me_requires_token(client):
    response = await client.get("/profiles/me")
    assert response.status_code == 401
    assert response.json()["error"] == "missing_token"
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(
    "token",
    [
        make_token(secret="another-secret-that-is-also-32-bytes-long"),
        make_token(issuer="someone-else"),
        make_token(expires_in=timedelta(minutes=-5)),
        make_token(token_type="refresh"),
        make_token(user_id="not-a-uuid"),
        "not-a-jwt",
    ],
)
async def test_invalid_tokens_are_rejected(client, token):
    response = await client.get("/profiles/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.json()["error"] == "invalid_token"


async def test_forged_user_id_header_is_ignored(client):
    owner = uuid.uuid4()
    response = await client.get(
        "/profiles/me", headers={**auth_headers(owner), "X-User-ID": str(uuid.uuid4())}
    )
    assert response.json()["userId"] == str(owner)


# ==========================================
# Perfil propio
# ==========================================

async def test_me_creates_profile_lazily(client):
    user_id, body = await create_profile(client)

    assert body["userId"] == str(user_id)
    assert body["username"] == "ExploradorGeo"
    assert body["displayName"] == "ExploradorGeo"
    assert body["about"] is None
    assert body["avatarUrl"] is None
    assert body["color"] == default_color(user_id)
    # Respuesta directa, sin sobre { success, data }
    assert "success" not in body and "data" not in body


async def test_me_is_stable_across_calls(client):
    user_id, first = await create_profile(client)
    _, second = await create_profile(client, user_id=user_id)
    assert first == second


async def test_dev_token_without_username_gets_placeholder(client):
    user_id = uuid.uuid4()
    response = await client.get("/profiles/me", headers=auth_headers(user_id, username=None))
    assert response.json()["username"] == f"user-{user_id.hex[:8]}"


def test_default_color_is_deterministic():
    user_id = uuid.uuid4()
    assert default_color(user_id) == default_color(user_id)
    assert default_color(user_id) in PALETTE


async def test_patch_updates_fields_and_publishes_event(client, publisher):
    user_id, _ = await create_profile(client)

    response = await client.patch(
        "/profiles/me",
        headers=auth_headers(user_id),
        # Fuera de la paleta, para que siempre difiera del color generado
        json={"displayName": "  Explorador  ", "about": "Cazando pictos por Bogotá.", "color": "#12ab3c"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["displayName"] == "Explorador"
    assert body["about"] == "Cazando pictos por Bogotá."
    assert body["color"] == "#12AB3C"
    assert body["username"] == "ExploradorGeo"

    assert len(publisher.events) == 1
    event = publisher.events[0].model_dump(by_alias=True, mode="json")
    assert event["eventType"] == "profile.updated.v1"
    assert event["producer"] == "profile"
    assert event["payload"]["userId"] == str(user_id)
    assert event["payload"]["changedFields"] == ["displayName", "about", "color"]
    assert event["payload"]["color"] == "#12AB3C"


async def test_patch_only_touches_sent_fields(client, publisher):
    user_id, _ = await create_profile(client)
    await client.patch("/profiles/me", headers=auth_headers(user_id), json={"about": "Hola"})

    response = await client.patch("/profiles/me", headers=auth_headers(user_id), json={"color": "#123456"})

    body = response.json()
    assert body["about"] == "Hola"
    assert body["displayName"] == "ExploradorGeo"
    assert publisher.events[-1].payload.changed_fields == ["color"]


async def test_patch_without_changes_does_not_publish(client, publisher):
    user_id, before = await create_profile(client)

    response = await client.patch(
        "/profiles/me", headers=auth_headers(user_id), json={"displayName": "ExploradorGeo"}
    )

    assert response.status_code == 200
    assert response.json()["updatedAt"] == before["updatedAt"]
    assert publisher.events == []


async def test_patch_null_clears_and_resets(client):
    user_id, _ = await create_profile(client)
    await client.patch(
        "/profiles/me", headers=auth_headers(user_id), json={"about": "Hola", "color": "#000000"}
    )

    response = await client.patch(
        "/profiles/me",
        headers=auth_headers(user_id),
        json={"displayName": None, "about": None, "color": None},
    )

    body = response.json()
    assert body["displayName"] is None
    assert body["about"] is None
    assert body["color"] == default_color(user_id)


async def test_patch_still_succeeds_when_broker_is_down(client, publisher):
    publisher.fail = True
    user_id, _ = await create_profile(client)

    response = await client.patch("/profiles/me", headers=auth_headers(user_id), json={"about": "Hola"})

    assert response.status_code == 200
    assert response.json()["about"] == "Hola"


@pytest.mark.parametrize(
    "body",
    [
        {"displayName": ""},
        {"displayName": "   "},
        {"displayName": "x" * 51},
        {"displayName": "Hola\x07"},
        {"about": "x" * 501},
        {"about": "texto\x00"},
        {"color": "2AC769"},
        {"color": "#2AC76"},
        {"color": "#GGGGGG"},
    ],
)
async def test_patch_rejects_invalid_values(client, body):
    user_id, _ = await create_profile(client)
    response = await client.patch("/profiles/me", headers=auth_headers(user_id), json=body)
    assert response.status_code == 422
    assert response.json()["error"] == "validation_error"


@pytest.mark.parametrize("field", ["username", "email"])
async def test_patch_cannot_change_identity(client, field):
    user_id, _ = await create_profile(client)
    response = await client.patch("/profiles/me", headers=auth_headers(user_id), json={field: "otro"})
    assert response.status_code == 422
    assert "autenticación" in response.json()["message"]


async def test_about_keeps_line_breaks(client):
    user_id, _ = await create_profile(client)
    response = await client.patch(
        "/profiles/me", headers=auth_headers(user_id), json={"about": "Línea 1\r\nLínea 2"}
    )
    assert response.json()["about"] == "Línea 1\nLínea 2"


async def test_display_name_accepts_emoji(client):
    user_id, _ = await create_profile(client)
    response = await client.patch(
        "/profiles/me", headers=auth_headers(user_id), json={"displayName": "Geo 👩‍🚀"}
    )
    assert response.status_code == 200
    assert response.json()["displayName"] == "Geo 👩‍🚀"


# ==========================================
# Perfiles de otros usuarios
# ==========================================

async def test_get_profile_by_id(client):
    user_id, created = await create_profile(client)
    response = await client.get(f"/profiles/{user_id}", headers=auth_headers())
    assert response.status_code == 200
    assert response.json() == created


async def test_get_unknown_profile_returns_404(client):
    response = await client.get(f"/profiles/{uuid.uuid4()}", headers=auth_headers())
    assert response.status_code == 404
    assert response.json()["error"] == "profile_not_found"


async def test_get_profile_requires_token(client):
    user_id, _ = await create_profile(client)
    response = await client.get(f"/profiles/{user_id}")
    assert response.status_code == 401


async def test_get_profile_with_invalid_id(client):
    response = await client.get("/profiles/not-a-uuid", headers=auth_headers())
    assert response.status_code == 422


async def test_batch_keeps_order_and_skips_missing(client):
    first, _ = await create_profile(client, "Primero")
    second, _ = await create_profile(client, "Segundo")
    missing = uuid.uuid4()

    response = await client.get(
        f"/profiles/batch?ids={second},{missing},{first},{second}", headers=auth_headers()
    )

    assert response.status_code == 200
    assert [p["username"] for p in response.json()] == ["Segundo", "Primero"]


async def test_batch_resolves_100_ids(client):
    ids = [str((await create_profile(client, f"user{i}"))[0]) for i in range(100)]
    response = await client.get(f"/profiles/batch?ids={','.join(ids)}", headers=auth_headers())
    assert response.status_code == 200
    assert len(response.json()) == 100


@pytest.mark.parametrize(
    "ids",
    [",".join(str(uuid.uuid4()) for _ in range(101)), "not-a-uuid", ",,"],
)
async def test_batch_rejects_invalid_ids(client, ids):
    response = await client.get(f"/profiles/batch?ids={ids}", headers=auth_headers())
    assert response.status_code == 422
    assert response.json()["error"] == "validation_error"


async def test_search_matches_display_name_and_username(client):
    explorer, _ = await create_profile(client, "ExploradorGeo")
    await create_profile(client, "CazadorDePictos")
    await client.patch("/profiles/me", headers=auth_headers(explorer), json={"displayName": "Marta"})

    by_display = await client.get("/profiles/search?q=mart", headers=auth_headers())
    by_username = await client.get("/profiles/search?q=CAZADOR", headers=auth_headers())

    assert [p["username"] for p in by_display.json()] == ["ExploradorGeo"]
    assert [p["username"] for p in by_username.json()] == ["CazadorDePictos"]


async def test_search_treats_wildcards_literally(client):
    await create_profile(client, "ana_maria")
    await create_profile(client, "anaXmaria")

    response = await client.get("/profiles/search?q=a_m", headers=auth_headers())

    assert [p["username"] for p in response.json()] == ["ana_maria"]


async def test_search_respects_limit(client):
    for i in range(5):
        await create_profile(client, f"geo{i}")
    response = await client.get("/profiles/search?q=geo&limit=2", headers=auth_headers())
    assert len(response.json()) == 2


async def test_health(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok", "storage": "ok"}


async def test_health_reports_storage_down(client, storage):
    storage.fail = True
    response = await client.get("/health")
    assert response.status_code == 503
    assert response.json()["storage"] == "unavailable"
