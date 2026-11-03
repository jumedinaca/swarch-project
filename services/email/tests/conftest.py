import socket
from email import message_from_bytes
from email.message import EmailMessage
from email.policy import default as default_email_policy

import pytest
from aiosmtpd.controller import Controller
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
from app.domain.models import Base
from app.main import create_app


class RecordingSmtpHandler:
    """Servidor SMTP real de pruebas basado en `aiosmtpd`."""

    def __init__(self) -> None:
        self.messages: list[EmailMessage] = []
        self.envelopes: list[tuple[str, list[str]]] = []
        self.fail_mode: str | None = None  # "transient" | "permanent" | None
        self.fail_remaining: int = 0

    async def handle_DATA(self, server, session, envelope) -> str:
        if self.fail_remaining > 0:
            self.fail_remaining -= 1
            rcpt = envelope.rcpt_tos[0] if envelope.rcpt_tos else "user@example.com"
            return f"421 4.4.2 Fallo temporal entregando a {rcpt}"

        if self.fail_mode == "transient":
            rcpt = envelope.rcpt_tos[0] if envelope.rcpt_tos else "user@example.com"
            return f"421 4.4.2 Servicio SMTP ocupado para {rcpt}"

        if self.fail_mode == "permanent":
            rcpt = envelope.rcpt_tos[0] if envelope.rcpt_tos else "user@example.com"
            return f"550 5.1.1 Buzón inexistente {rcpt}"

        parsed = message_from_bytes(envelope.original_content, policy=default_email_policy)
        assert isinstance(parsed, EmailMessage)
        self.messages.append(parsed)
        self.envelopes.append((envelope.mail_from, list(envelope.rcpt_tos)))
        return "250 OK"


class FakeEventPublisher:
    """Captura eventos `email.sent.v1` y `email.failed.v1` sin requerir RabbitMQ."""

    def __init__(self) -> None:
        self.events = []

    async def publish(self, event) -> None:
        self.events.append(event)


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture
def smtp_server():
    handler = RecordingSmtpHandler()
    controller = Controller(handler, hostname="127.0.0.1", port=_find_free_port())
    controller.start()
    try:
        yield controller, handler
    finally:
        try:
            controller.stop()
        except Exception:
            pass


@pytest.fixture
def internal_token() -> str:
    return "test-internal-token-secret"


@pytest.fixture
def settings(tmp_path, smtp_server, internal_token) -> Settings:
    controller, _ = smtp_server
    return Settings(
        _env_file=None,
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'email.db'}",
        internal_token=internal_token,
        rabbitmq_url="",
        publish_status_events=True,
        smtp_host=controller.hostname,
        smtp_port=controller.port,
        smtp_use_tls=False,
        smtp_starttls=False,
        smtp_timeout_seconds=3.0,
        smtp_from="GeoPicto <no-reply@geopicto.org>",
        default_reply_to="no-reply@geopicto.org",
        rate_limit_per_recipient_per_hour=5,
        global_rate_limit_per_minute=100,
        retry_delays_seconds="0.03,0.05,0.08",
        retention_days=30,
    )


@pytest.fixture
def publisher() -> FakeEventPublisher:
    return FakeEventPublisher()


@pytest.fixture
async def app(settings, publisher):
    application = create_app(settings)
    application.state.event_publisher = publisher
    async with application.state.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def internal_headers(token: str = "test-internal-token-secret") -> dict[str, str]:
    return {"X-Internal-Token": token}
