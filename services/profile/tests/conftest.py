import io
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.core.config import Settings
from app.domain.models import Base
from app.main import create_app

SECRET = "test-secret-test-secret-test-secret-123"
ISSUER = "geopicto-auth"


class FakeProfileEventPublisher:
    """Captura los eventos publicados y permite simular un broker caído."""

    def __init__(self) -> None:
        self.events = []
        self.fail = False

    async def publish(self, event) -> None:
        if self.fail:
            raise RuntimeError("RabbitMQ no disponible")
        self.events.append(event)


class MemoryAvatarStorage:
    """Sustituye a MinIO en las pruebas."""

    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.fail = False

    async def initialize(self) -> None:
        pass

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        if self.fail:
            raise RuntimeError("MinIO no disponible")
        self.objects[key] = (data, content_type)

    async def get(self, key: str) -> bytes | None:
        entry = self.objects.get(key)
        return entry[0] if entry else None

    async def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    async def ping(self) -> bool:
        return not self.fail


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        _env_file=None,
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'profile.db'}",
        jwt_secret=SECRET,
        rabbitmq_url="",
        minio_endpoint="",
        avatar_public_base_url="http://gateway.test/api/profiles/avatars",
        avatar_uploads_per_hour=10,
    )


@pytest.fixture
def publisher() -> FakeProfileEventPublisher:
    return FakeProfileEventPublisher()


@pytest.fixture
def storage() -> MemoryAvatarStorage:
    return MemoryAvatarStorage()


@pytest.fixture
async def app(settings, publisher, storage):
    app = create_app(settings)
    app.state.profile_event_publisher = publisher
    app.state.avatar_storage = storage
    async with app.state.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield app
    await app.state.engine.dispose()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def make_token(
    user_id: uuid.UUID | str | None = None,
    username: str | None = "ExploradorGeo",
    *,
    secret: str = SECRET,
    issuer: str = ISSUER,
    expires_in: timedelta = timedelta(minutes=15),
    token_type: str | None = "access",
) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id or uuid.uuid4()), "iss": issuer, "iat": now, "exp": now + expires_in}
    if username is not None:
        payload["username"] = username
    if token_type is not None:
        payload["type"] = token_type
    return jwt.encode(payload, secret, algorithm="HS256")


def auth_headers(user_id: uuid.UUID | None = None, username: str | None = "ExploradorGeo") -> dict:
    return {"Authorization": f"Bearer {make_token(user_id, username)}"}


def image_bytes(fmt: str = "PNG", size: tuple[int, int] = (300, 200), color=(42, 199, 105), **save_kwargs) -> bytes:
    mode = "RGBA" if fmt == "PNG" and save_kwargs.pop("alpha", False) else "RGB"
    buffer = io.BytesIO()
    Image.new(mode, size, color).save(buffer, format=fmt, **save_kwargs)
    return buffer.getvalue()
