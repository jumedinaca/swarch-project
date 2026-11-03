import time
import uuid

from tests.conftest import internal_headers


async def test_internal_endpoints_require_token(client):
    resp_missing = await client.post(
        "/internal/emails",
        json={"to": "explorador@geochat.org", "template": "welcome", "variables": {"username": "Geo"}},
    )
    assert resp_missing.status_code == 401
    assert resp_missing.json()["error"] == "unauthorized"

    resp_wrong = await client.get(f"/internal/emails/{uuid.uuid4()}", headers=internal_headers("wrong-token"))
    assert resp_wrong.status_code == 401
    assert resp_wrong.json()["error"] == "unauthorized"


async def test_post_and_get_internal_email_direct_envelope_and_delivery(app, client, smtp_server):
    _, handler = smtp_server

    t0 = time.perf_counter()
    resp = await client.post(
        "/internal/emails",
        headers=internal_headers(),
        json={
            "to": "Explorador@GeoChat.org",
            "template": "generic",
            "subject": "Novedades en GeoPicto",
            "variables": {
                "title": "Hola explorador",
                "body": "Hay nuevos mensajes cerca.",
                "ctaUrl": "https://geopicto.org/mapa",
                "ctaLabel": "Ver mapa",
            },
            "idempotencyKey": "news:2026-11-02",
        },
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000

    assert resp.status_code == 202
    assert elapsed_ms < 200
    data = resp.json()
    # Respuesta directa sin sobre { success, data }
    assert "success" not in data and "data" not in data
    assert data["status"] == "QUEUED"
    email_id = data["emailId"]

    await app.state.local_worker.wait_idle()

    assert len(handler.messages) == 1
    msg = handler.messages[0]
    assert msg["To"] == "explorador@geochat.org"
    assert msg["Reply-To"] == "no-reply@geopicto.org"
    assert msg["Subject"] == "Novedades en GeoPicto"
    assert msg.get_content_type() == "multipart/alternative"
    subtypes = [part.get_content_subtype() for part in msg.iter_parts()]
    assert subtypes == ["plain", "html"]

    status_resp = await client.get(f"/internal/emails/{email_id}", headers=internal_headers())
    assert status_resp.status_code == 200
    status_body = status_resp.json()
    assert status_body["emailId"] == email_id
    assert status_body["status"] == "SENT"
    assert status_body["attempts"] == 1
    assert status_body["recipient"] == "e***@geochat.org"
    assert status_body["sentAt"] is not None


async def test_get_unknown_email_returns_404(client):
    resp = await client.get(f"/internal/emails/{uuid.uuid4()}", headers=internal_headers())
    assert resp.status_code == 404
    assert resp.json()["error"] == "email_not_found"


async def test_health_verifies_smtp_without_sending_email(client, smtp_server):
    controller, handler = smtp_server

    ok_resp = await client.get("/health")
    assert ok_resp.status_code == 200
    body = ok_resp.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert body["smtp"] == "ok"
    assert len(handler.messages) == 0

    controller.stop()
    down_resp = await client.get("/health")
    assert down_resp.status_code == 503
    down_body = down_resp.json()
    assert down_body["status"] == "degraded"
    assert down_body["smtp"] == "unavailable"
    assert len(handler.messages) == 0
