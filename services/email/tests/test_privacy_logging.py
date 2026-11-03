from app.core.logging import configure_logging, get_logger, mask_email, sanitize_error
from tests.conftest import internal_headers


def test_mask_email_formats_correctly():
    assert mask_email("juan@dominio.com") == "j***@dominio.com"
    assert mask_email("  Explorador@GeoChat.ORG ") == "e***@geochat.org"
    assert mask_email("a@b.co") == "a***@b.co"
    assert mask_email("") == "***"


def test_sanitize_error_strips_emails_and_truncates():
    raw = "550 5.1.1 <secreto.personal@geochat.org>: Recipient address rejected\r\n" + ("x" * 600)
    cleaned = sanitize_error(raw, recipient="secreto.personal@geochat.org", max_len=120)
    assert "secreto.personal@geochat.org" not in cleaned
    assert "s***@geochat.org" in cleaned
    assert len(cleaned) <= 120
    assert "\r" not in cleaned and "\n" not in cleaned


async def test_no_full_email_or_body_logged_on_success_or_failure(app, client, smtp_server, capsys):
    _, handler = smtp_server
    configure_logging()
    secret_email = "privacidad.absoluta@geochat.org"
    secret_body = "CODIGO_CONFIDENCIAL_NO_LOGUEAR_998877"

    # 1) Envío exitoso
    ok_resp = await client.post(
        "/internal/emails",
        headers=internal_headers(),
        json={
            "to": secret_email,
            "template": "generic",
            "subject": "Mensaje privado",
            "variables": {"title": "Aviso", "body": secret_body},
        },
    )
    assert ok_resp.status_code == 202
    await app.state.local_worker.wait_idle()

    # 2) Fallo permanente donde el servidor SMTP devuelve el correo completo en el texto de error
    handler.fail_mode = "permanent"
    fail_email = "fallo.privado@geochat.org"
    fail_resp = await client.post(
        "/internal/emails",
        headers=internal_headers(),
        json={
            "to": fail_email,
            "template": "generic",
            "subject": "Otro privado",
            "variables": {"title": "Aviso", "body": secret_body},
        },
    )
    fail_id = fail_resp.json()["emailId"]
    await app.state.local_worker.wait_idle()

    # 3) Intento explícito de loguear claves sensibles en structlog
    log = get_logger("test")
    log.info("evento_prueba", to=secret_email, body=secret_body, variables={"body": secret_body})

    captured = capsys.readouterr()
    combined_logs = captured.out + "\n" + captured.err

    assert secret_email not in combined_logs
    assert fail_email not in combined_logs
    assert secret_body not in combined_logs
    assert "p***@geochat.org" in combined_logs
    assert "f***@geochat.org" in combined_logs

    status_resp = await client.get(f"/internal/emails/{fail_id}", headers=internal_headers())
    status_data = status_resp.json()
    assert status_data["recipient"] == "f***@geochat.org"
    assert fail_email not in (status_data["lastError"] or "")
    assert "f***@geochat.org" in (status_data["lastError"] or "")
    assert secret_body not in (status_data["lastError"] or "")
