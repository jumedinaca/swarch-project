import json
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
from app.domain.models import Base
from app.main import create_app
from app.service.classifier import ClassifierUnavailable, Prediction

INTERNAL_TOKEN = "test-internal-token"


class FakePublisher:
    """Captura los eventos publicados y permite simular un broker caído."""

    def __init__(self) -> None:
        self.events = []
        self.fail = False

    async def publish(self, event) -> None:
        if self.fail:
            raise RuntimeError("RabbitMQ no disponible")
        self.events.append(event)


class FakeClassifier:
    """Devuelve la predicción configurada, o falla si `prediction` es None."""

    name = "fake"

    def __init__(self) -> None:
        self.prediction: Prediction | None = Prediction("ALLOW", 0.98, "fake-model-1")
        self.calls: list[str] = []

    async def predict(self, text: str) -> Prediction:
        self.calls.append(text)
        if self.prediction is None:
            raise ClassifierUnavailable("down")
        return self.prediction


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        _env_file=None,
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'moderation.db'}",
        rabbitmq_url="",
        internal_token=INTERNAL_TOKEN,
        openai_api_key="",
        retry_base_seconds=0,
    )


@pytest.fixture
def publisher() -> FakePublisher:
    return FakePublisher()


@pytest.fixture
def classifier() -> FakeClassifier:
    return FakeClassifier()


@pytest.fixture
async def app(settings, publisher, classifier):
    app = create_app(settings)
    app.state.moderation_event_publisher = publisher
    app.state.classifier = classifier
    async with app.state.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield app
    await app.state.engine.dispose()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def internal_headers() -> dict:
    return {"X-Internal-Token": INTERNAL_TOKEN}


def submitted(
    content: str,
    *,
    message_id: uuid.UUID | None = None,
    author_id: uuid.UUID | None = None,
    version: int = 1,
) -> bytes:
    return json.dumps(
        {
            "eventId": str(uuid.uuid4()),
            "eventType": "message.submitted.v1",
            "version": 1,
            "occurredAt": "2026-11-02T14:30:00Z",
            "producer": "messages",
            "correlationId": str(uuid.uuid4()),
            "causationId": None,
            "payload": {
                "messageId": str(message_id or uuid.uuid4()),
                "authorId": str(author_id or uuid.uuid4()),
                "content": content,
                "latitude": 4.6371,
                "longitude": -74.0834,
                "messageVersion": version,
                "createdAt": "2026-11-02T14:30:00Z",
            },
        }
    ).encode()
