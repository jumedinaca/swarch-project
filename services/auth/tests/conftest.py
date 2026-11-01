import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
from app.domain.models import Base
from app.main import create_app


class FakeUserEventPublisher:
    """Captura los eventos publicados y permite simular un broker caído."""

    def __init__(self) -> None:
        self.events = []
        self.fail = False

    async def publish(self, event) -> None:
        if self.fail:
            raise RuntimeError("RabbitMQ no disponible")
        self.events.append(event)


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        _env_file=None,
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'auth.db'}",
        jwt_secret="test-secret-test-secret-test-secret-123",
        max_failed_login_attempts=3,
        rabbitmq_url="",
    )


@pytest.fixture
def publisher() -> FakeUserEventPublisher:
    return FakeUserEventPublisher()


@pytest.fixture
async def client(settings, publisher):
    app = create_app(settings)
    app.state.user_event_publisher = publisher
    async with app.state.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    await app.state.engine.dispose()


async def register(client, username="Explorador", email="explorador@geochat.org", password="secreto123"):
    return await client.post(
        "/auth/register", json={"username": username, "email": email, "password": password}
    )


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
