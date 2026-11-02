import json
import uuid

import pytest

from app.messaging.consumer import InvalidEventError, UserEventConsumer
from tests.conftest import auth_headers, image_bytes


def envelope(event_type: str, **payload) -> bytes:
    return json.dumps(
        {
            "eventId": str(uuid.uuid4()),
            "eventType": event_type,
            "version": 1,
            "occurredAt": "2026-10-24T14:30:00Z",
            "producer": "auth",
            "correlationId": str(uuid.uuid4()),
            "causationId": None,
            "payload": payload,
        }
    ).encode()


def registered(user_id: uuid.UUID, username: str = "ExploradorGeo") -> bytes:
    return envelope(
        "user.registered.v1",
        userId=str(user_id),
        username=username,
        email="explorador@geochat.org",
        registeredAt="2026-10-24T14:30:00Z",
    )


@pytest.fixture
def consumer(app) -> UserEventConsumer:
    return UserEventConsumer(None, "geopicto.events", app.state.service_scope)


async def get_profile(client, user_id):
    return await client.get(f"/profiles/{user_id}", headers=auth_headers())


async def test_user_registered_creates_profile(client, consumer):
    user_id = uuid.uuid4()

    await consumer.dispatch("user.registered.v1", registered(user_id))

    response = await get_profile(client, user_id)
    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "ExploradorGeo"
    assert body["displayName"] == "ExploradorGeo"
    assert body["color"].startswith("#")


async def test_user_registered_is_idempotent(client, consumer):
    user_id = uuid.uuid4()
    await consumer.dispatch("user.registered.v1", registered(user_id))
    await client.patch("/profiles/me", headers=auth_headers(user_id), json={"about": "Hola"})

    await consumer.dispatch("user.registered.v1", registered(user_id))

    assert (await get_profile(client, user_id)).json()["about"] == "Hola"


async def test_user_registered_fixes_lazy_placeholder(client, consumer):
    user_id = uuid.uuid4()
    await client.get("/profiles/me", headers=auth_headers(user_id, username=None))

    await consumer.dispatch("user.registered.v1", registered(user_id, "NombreReal"))

    body = (await get_profile(client, user_id)).json()
    assert body["username"] == "NombreReal"
    assert body["displayName"] == "NombreReal"


async def test_user_updated_syncs_username(client, consumer):
    user_id = uuid.uuid4()
    await consumer.dispatch("user.registered.v1", registered(user_id, "Viejo"))

    await consumer.dispatch(
        "user.updated.v1",
        envelope("user.updated.v1", userId=str(user_id), username="Nuevo", changedFields=["username"]),
    )

    body = (await get_profile(client, user_id)).json()
    assert body["username"] == "Nuevo"
    # displayName seguía siendo la copia del username, así que se actualiza
    assert body["displayName"] == "Nuevo"


async def test_user_updated_keeps_custom_display_name(client, consumer):
    user_id = uuid.uuid4()
    await consumer.dispatch("user.registered.v1", registered(user_id, "Viejo"))
    await client.patch("/profiles/me", headers=auth_headers(user_id), json={"displayName": "Marta"})

    await consumer.dispatch(
        "user.updated.v1", envelope("user.updated.v1", userId=str(user_id), username="Nuevo")
    )

    body = (await get_profile(client, user_id)).json()
    assert body["username"] == "Nuevo"
    assert body["displayName"] == "Marta"


async def test_user_deleted_removes_profile_and_avatar(client, consumer, storage):
    user_id = uuid.uuid4()
    await client.post(
        "/profiles/me/avatar",
        headers=auth_headers(user_id),
        files={"file": ("a.png", image_bytes(), "image/png")},
    )
    assert storage.objects

    await consumer.dispatch("user.deleted.v1", envelope("user.deleted.v1", userId=str(user_id)))
    # Repetido: no falla
    await consumer.dispatch("user.deleted.v1", envelope("user.deleted.v1", userId=str(user_id)))

    assert (await get_profile(client, user_id)).status_code == 404
    assert storage.objects == {}


@pytest.mark.parametrize(
    "body",
    [
        b"no es json",
        json.dumps({"eventType": "user.registered.v1"}).encode(),
        envelope("user.registered.v1", userId="not-a-uuid", username="x"),
        envelope("user.registered.v1", username="sin-id"),
    ],
)
async def test_malformed_events_are_rejected(consumer, body):
    with pytest.raises(InvalidEventError):
        await consumer.dispatch("user.registered.v1", body)


class FakeMessage:
    def __init__(self, body: bytes):
        self.body = body
        self.message_id = str(uuid.uuid4())
        self.result = None

    async def ack(self):
        self.result = "ack"

    async def reject(self, requeue: bool = False):
        self.result = f"reject(requeue={requeue})"

    async def nack(self, requeue: bool = True):
        self.result = f"nack(requeue={requeue})"


async def test_valid_message_is_acked(consumer):
    message = FakeMessage(registered(uuid.uuid4()))
    await consumer._on_message("user.registered.v1", message)
    assert message.result == "ack"


async def test_poison_message_is_discarded(consumer):
    message = FakeMessage(b"basura")
    await consumer._on_message("user.registered.v1", message)
    assert message.result == "reject(requeue=False)"


async def test_transient_failure_requeues(app, consumer, monkeypatch):
    monkeypatch.setattr("app.messaging.consumer.REQUEUE_DELAY_SECONDS", 0)
    await app.state.engine.dispose()
    # Sin la tabla, la BD falla como si estuviera caída.
    async with app.state.engine.begin() as conn:
        await conn.exec_driver_sql("DROP TABLE profiles")

    message = FakeMessage(registered(uuid.uuid4()))
    await consumer._on_message("user.registered.v1", message)

    assert message.result == "nack(requeue=True)"
