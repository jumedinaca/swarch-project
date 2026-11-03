import json
import uuid
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock

from app.core.ratelimit import SlidingWindowRateLimiter
from app.domain.models import EmailLog, utcnow
from app.messaging.consumer import EmailEventConsumer
from app.messaging.events import parse_incoming_event
from app.repository.email_repository import EmailRepository
from tests.conftest import internal_headers


async def test_user_registered_event_sends_welcome_and_is_idempotent(app, smtp_server, publisher):
    _, handler = smtp_server
    user_id = uuid.uuid4()
    envelope = {
        "eventId": str(uuid.uuid4()),
        "eventType": "user.registered.v1",
        "version": 1,
        "occurredAt": "2026-10-24T14:30:00Z",
        "producer": "auth",
        "correlationId": str(uuid.uuid4()),
        "causationId": None,
        "payload": {
            "userId": str(user_id),
            "username": "ExploradorGeo",
            "email": "Explorador@GeoChat.org",
            "registeredAt": "2026-10-24T14:30:00Z",
        },
    }

    job1 = parse_incoming_event("user.registered.v1", envelope)
    assert job1.idempotency_key == f"welcome:{user_id}"
    assert job1.to == "explorador@geochat.org"

    await app.state.local_worker.enqueue(job1)
    await app.state.local_worker.wait_idle()

    # Reentrega del mismo evento de registro: no debe volver a enviar.
    job2 = parse_incoming_event("user.registered.v1", envelope)
    await app.state.local_worker.enqueue(job2)
    await app.state.local_worker.wait_idle()

    assert len(handler.messages) == 1
    sent_msg = handler.messages[0]
    assert "ExploradorGeo" in sent_msg["Subject"]
    assert sent_msg.get_content_type() == "multipart/alternative"

    sent_events = [e for e in publisher.events if e.event_type == "email.sent.v1"]
    assert len(sent_events) == 1
    assert sent_events[0].payload.idempotency_key == f"welcome:{user_id}"


async def test_email_requested_uses_email_id_when_idempotency_key_missing(app, smtp_server):
    _, handler = smtp_server
    email_id = uuid.uuid4()
    envelope = {
        "eventId": str(uuid.uuid4()),
        "eventType": "email.requested.v1",
        "version": 1,
        "occurredAt": "2026-10-24T14:30:00Z",
        "producer": "otro-servicio",
        "correlationId": str(uuid.uuid4()),
        "payload": {
            "emailId": str(email_id),
            "to": "usuaria@geochat.org",
            "template": "generic",
            "subject": "Aviso importante",
            "variables": {"title": "Hola", "body": "Contenido del aviso"},
            "idempotencyKey": None,
            "replyTo": "soporte@geopicto.org",
            "requestedAt": "2026-10-24T14:30:00Z",
        },
    }

    job = parse_incoming_event("email.requested.v1", envelope)
    assert job.idempotency_key == str(email_id)

    await app.state.local_worker.enqueue(job)
    await app.state.local_worker.enqueue(job)
    await app.state.local_worker.wait_idle()

    assert len(handler.messages) == 1
    assert handler.messages[0]["Reply-To"] == "soporte@geopicto.org"


async def test_transient_smtp_failure_retries_and_recovers(app, client, smtp_server):
    _, handler = smtp_server
    handler.fail_remaining = 2  # Falla en intentos 1 y 2, triunfa en intento 3.

    resp = await client.post(
        "/internal/emails",
        headers=internal_headers(),
        json={
            "to": "reintento@geochat.org",
            "template": "welcome",
            "variables": {"username": "Reintentador"},
        },
    )
    email_id = resp.json()["emailId"]

    await app.state.local_worker.wait_idle(timeout=5.0)

    assert len(handler.messages) == 1
    status_resp = await client.get(f"/internal/emails/{email_id}", headers=internal_headers())
    body = status_resp.json()
    assert body["status"] == "SENT"
    assert body["attempts"] == 3


async def test_exhausted_smtp_retries_end_in_dlq(app, client, smtp_server, publisher):
    _, handler = smtp_server
    handler.fail_mode = "transient"

    resp = await client.post(
        "/internal/emails",
        headers=internal_headers(),
        json={
            "to": "falla@geochat.org",
            "template": "welcome",
            "variables": {"username": "DestinoDLQ"},
            "idempotencyKey": "dlq-test-1",
        },
    )
    email_id = resp.json()["emailId"]

    await app.state.local_worker.wait_idle(timeout=5.0)

    assert len(handler.messages) == 0
    status_resp = await client.get(f"/internal/emails/{email_id}", headers=internal_headers())
    body = status_resp.json()
    assert body["status"] == "DLQ"
    # 1 intento inicial + 3 reintentos (10s, 1m, 5m configurados en test a 30/50/80 ms) = 4 intentos
    assert body["attempts"] == 4
    assert len(app.state.local_worker.dlq_messages) == 1
    assert app.state.local_worker.dlq_messages[0].status == "DLQ"

    failed_events = [e for e in publisher.events if e.event_type == "email.failed.v1"]
    assert len(failed_events) == 1
    assert failed_events[0].payload.status == "DLQ"


async def test_permanent_smtp_550_fails_immediately_without_retries(app, client, smtp_server):
    _, handler = smtp_server
    handler.fail_mode = "permanent"

    resp = await client.post(
        "/internal/emails",
        headers=internal_headers(),
        json={
            "to": "inexistente@geochat.org",
            "template": "welcome",
            "variables": {"username": "SinBuzon"},
        },
    )
    email_id = resp.json()["emailId"]

    await app.state.local_worker.wait_idle(timeout=5.0)

    status_resp = await client.get(f"/internal/emails/{email_id}", headers=internal_headers())
    body = status_resp.json()
    assert body["status"] == "FAILED"
    assert body["attempts"] == 1


async def test_rabbitmq_consumer_rejects_invalid_event_without_requeue(app):
    consumer = EmailEventConsumer(
        connection=MagicMock(),
        exchange_name="geopicto.events",
        retry_delays_seconds=[10.0, 60.0, 300.0],
        service_scope=app.state.service_scope,
    )
    bad_msg = MagicMock()
    bad_msg.headers = {}
    bad_msg.message_id = "bad-1"
    bad_msg.body = json.dumps(
        {
            "eventType": "email.requested.v1",
            "payload": {
                "to": "correo-invalido-sin-arroba",
                "template": "generic",
                "subject": "Hola",
                "variables": {"title": "T", "body": "B"},
            },
        }
    ).encode("utf-8")
    bad_msg.reject = AsyncMock()
    bad_msg.ack = AsyncMock()

    await consumer._on_message("email.requested.v1", "send", bad_msg)
    bad_msg.reject.assert_awaited_once_with(requeue=False)
    bad_msg.ack.assert_not_awaited()


async def test_recipient_hourly_rate_limit_enforced(app, client, smtp_server):
    _, handler = smtp_server

    for idx in range(5):
        r = await client.post(
            "/internal/emails",
            headers=internal_headers(),
            json={
                "to": "limite@geochat.org",
                "template": "welcome",
                "variables": {"username": f"Intento{idx}"},
            },
        )
        assert r.status_code == 202

    await app.state.local_worker.wait_idle()
    assert len(handler.messages) == 5

    # El 6.º envío a la misma dirección dentro de la hora se rechaza por límite (5/hora).
    sixth = await client.post(
        "/internal/emails",
        headers=internal_headers(),
        json={
            "to": "LIMITE@geochat.org",
            "template": "welcome",
            "variables": {"username": "Intento6"},
        },
    )
    assert sixth.status_code == 429
    assert sixth.json()["error"] == "rate_limited"

    # Otro destinatario sí puede recibir correos normalmente.
    other = await client.post(
        "/internal/emails",
        headers=internal_headers(),
        json={
            "to": "otro@geochat.org",
            "template": "welcome",
            "variables": {"username": "Otro"},
        },
    )
    assert other.status_code == 202
    await app.state.local_worker.wait_idle()
    assert len(handler.messages) == 6


async def test_global_rate_limiter_defers_excess_and_delivers(app, client, smtp_server):
    _, handler = smtp_server
    # Ventana corta de 120 ms con máximo 2 correos para verificar diferimiento sin pérdida.
    app.state.global_limiter = SlidingWindowRateLimiter(limit=2, window_seconds=0.12)

    for idx in range(4):
        resp = await client.post(
            "/internal/emails",
            headers=internal_headers(),
            json={
                "to": f"user{idx}@geochat.org",
                "template": "welcome",
                "variables": {"username": f"U{idx}"},
            },
        )
        assert resp.status_code == 202

    await app.state.local_worker.wait_idle(timeout=5.0)
    assert len(handler.messages) == 4


async def test_retention_purges_old_email_logs(app):
    async with app.state.session_factory() as db:
        repo = EmailRepository(db)
        old_time = utcnow() - timedelta(days=45)
        old_row = EmailLog(
            id=uuid.uuid4(),
            idempotency_key="old-row",
            recipient="viejo@geochat.org",
            template="welcome",
            subject="Antiguo",
            status="SENT",
            attempts=1,
            created_at=old_time,
            updated_at=old_time,
        )
        recent_row = EmailLog(
            id=uuid.uuid4(),
            idempotency_key="recent-row",
            recipient="reciente@geochat.org",
            template="welcome",
            subject="Reciente",
            status="SENT",
            attempts=1,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        db.add_all([old_row, recent_row])
        await db.commit()

        deleted = await repo.purge_expired(retention_days=30)
        assert deleted == 1
        assert await repo.get_by_idempotency_key("old-row") is None
        assert await repo.get_by_idempotency_key("recent-row") is not None
