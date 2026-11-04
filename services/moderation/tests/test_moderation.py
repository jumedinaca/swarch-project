import uuid

import httpx
import pytest

from app.messaging.consumer import MessageEventConsumer
from app.service.classifier import OpenAIModerationClassifier, Prediction
from app.service.moderation_service import ModerationRequest
from tests.conftest import internal_headers, submitted


@pytest.fixture
def consumer(app, publisher) -> MessageEventConsumer:
    return MessageEventConsumer(
        None, "geopicto.events", app.state.service_scope, publisher, max_attempts=3, retry_base_seconds=0
    )


def completed(publisher):
    return [e for e in publisher.events if e.event_type == "moderation.completed.v1"]


async def test_clean_message_is_allowed_and_published(consumer, publisher):
    message_id = uuid.uuid4()

    assert await consumer.process(submitted("Hola desde la prueba", message_id=message_id))

    [event] = completed(publisher)
    assert event.payload.message_id == message_id
    assert event.payload.decision == "ALLOW"
    assert event.payload.reasons == ["OK"]
    assert event.payload.model_version == "fake-model-1"
    assert event.payload.degraded is False
    assert event.causation_id is not None


async def test_rule_block_wins_over_model_allow(consumer, publisher, classifier):
    classifier.prediction = Prediction("ALLOW", 0.99, "fake-model-1")

    await consumer.process(submitted("te voy a matar"))

    [event] = completed(publisher)
    assert event.payload.decision == "BLOCK"
    assert "THREAT" in event.payload.reasons


async def test_model_block_and_warn(consumer, publisher, classifier):
    classifier.prediction = Prediction("BLOCK", 0.93, "fake-model-1", ["harassment/threatening"])
    await consumer.process(submitted("algo grave"))
    classifier.prediction = Prediction("WARN", 0.7, "fake-model-1", ["harassment"])
    await consumer.process(submitted("algo grosero"))

    blocked, warned = completed(publisher)
    assert blocked.payload.decision == "BLOCK"
    assert blocked.payload.reasons == ["MODEL_BLOCK", "CATEGORY_HARASSMENT_THREATENING"]
    assert warned.payload.decision == "WARN"
    assert warned.payload.confidence == pytest.approx(0.7)


async def test_classifier_down_falls_back_to_rules(consumer, publisher, classifier):
    classifier.prediction = None

    assert await consumer.process(submitted("Hola"))

    [event] = completed(publisher)
    assert event.payload.decision == "ALLOW"
    assert event.payload.degraded is True
    assert event.payload.model_version is None
    assert "MODEL_UNAVAILABLE" in event.payload.reasons


async def test_redelivery_does_not_duplicate_decision(app, consumer, publisher, classifier):
    message_id = uuid.uuid4()
    body = submitted("Hola", message_id=message_id)

    await consumer.process(body)
    classifier.prediction = Prediction("BLOCK", 0.99, "fake-model-1")
    await consumer.process(body)

    first, second = completed(publisher)
    # Se vuelve a publicar la misma decisión, sin reevaluar.
    assert first.payload.decision == second.payload.decision == "ALLOW"
    assert len(classifier.calls) == 1


async def test_new_version_is_moderated_again(consumer, publisher):
    message_id = uuid.uuid4()
    await consumer.process(submitted("Hola", message_id=message_id, version=1))
    await consumer.process(submitted("te voy a matar", message_id=message_id, version=2))

    v1, v2 = completed(publisher)
    assert (v1.payload.message_version, v1.payload.decision) == (1, "ALLOW")
    assert (v2.payload.message_version, v2.payload.decision) == (2, "BLOCK")


async def test_three_warnings_escalate_next_message(consumer, publisher):
    author_id = uuid.uuid4()
    for _ in range(3):
        await consumer.process(submitted("COMPREN YA ESTA OFERTA INCREIBLE", author_id=author_id))

    await consumer.process(submitted("Hola a todos", author_id=author_id))

    *warnings, last = completed(publisher)
    assert [w.payload.decision for w in warnings] == ["WARN"] * 3
    assert last.payload.decision == "BLOCK"
    assert "AUTHOR_ESCALATION" in last.payload.reasons


async def test_previous_block_turns_warning_into_block(consumer, publisher):
    author_id = uuid.uuid4()
    await consumer.process(submitted("te voy a matar", author_id=author_id))
    await consumer.process(submitted("Hola de nuevo", author_id=author_id))
    await consumer.process(submitted("COMPREN YA ESTA OFERTA INCREIBLE", author_id=author_id))

    _, clean, warned = completed(publisher)
    assert clean.payload.decision == "ALLOW"
    assert warned.payload.decision == "BLOCK"


async def test_invalid_event_goes_to_dlq(consumer, publisher):
    assert await consumer.process(b"{not json") is False
    assert publisher.events == []


async def test_persistent_failure_publishes_failed(consumer, publisher):
    publisher.fail = True

    assert await consumer.process(submitted("Hola")) is False

    # La publicación de moderation.failed.v1 también falla, pero no revienta.
    assert publisher.events == []

    publisher.fail = False
    failing = {"count": 0}

    async def broken_moderate(*args, **kwargs):
        failing["count"] += 1
        raise RuntimeError("db down")

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def broken_scope():
        class Service:
            moderate = staticmethod(broken_moderate)

        yield Service()

    consumer.service_scope = broken_scope
    assert await consumer.process(submitted("Hola")) is False
    assert failing["count"] == 3
    [failed] = publisher.events
    assert failed.event_type == "moderation.failed.v1"
    assert failed.payload.reason == "MODERATION_ERROR:RuntimeError"


async def test_internal_moderate_is_dry_run(client, publisher):
    body = {"messageId": str(uuid.uuid4()), "authorId": str(uuid.uuid4()), "content": "llámame al 3105551234"}

    response = await client.post("/internal/moderate", json=body, headers=internal_headers())

    assert response.status_code == 200
    data = response.json()
    assert data["decision"] == "BLOCK"
    assert data["reasons"] == ["DOXXING"]
    assert data["ruleVersion"]
    assert publisher.events == []

    missing = await client.get(f"/internal/decisions/{body['messageId']}", headers=internal_headers())
    assert missing.status_code == 404
    assert missing.json()["error"] == "not_found"


async def test_internal_routes_require_token(client):
    response = await client.get(f"/internal/decisions/{uuid.uuid4()}")
    assert response.status_code == 401
    assert response.json()["error"] == "unauthorized"


async def test_get_latest_decision(client, consumer):
    message_id = uuid.uuid4()
    await consumer.process(submitted("Hola", message_id=message_id, version=1))
    await consumer.process(submitted("Hola editado", message_id=message_id, version=2))

    response = await client.get(f"/internal/decisions/{message_id}", headers=internal_headers())

    assert response.status_code == 200
    data = response.json()
    assert data["messageVersion"] == 2
    assert data["decidedAt"]


async def test_health(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["classifier"] == "fake"


async def test_moderate_logs_no_content(app, caplog):
    secret = "contenido-que-no-debe-salir-en-logs"
    async with app.state.service_scope() as service:
        await service.moderate(ModerationRequest(uuid.uuid4(), uuid.uuid4(), secret))
    assert secret not in caplog.text


# ---------- Clasificador de OpenAI (sin red) ----------


def openai_classifier(handler) -> OpenAIModerationClassifier:
    return OpenAIModerationClassifier(
        "sk-test",
        model="omni-moderation-latest",
        base_url="https://api.openai.test/v1",
        timeout_seconds=1,
        block_threshold=0.8,
        warn_threshold=0.6,
        transport=httpx.MockTransport(handler),
    )


def scores_response(**scores):
    base = {"harassment": 0.01, "harassment/threatening": 0.0, "violence": 0.0, "hate": 0.0}
    base.update({k.replace("__", "/"): v for k, v in scores.items()})
    return httpx.Response(
        200, json={"model": "omni-moderation-2024-09-26", "results": [{"category_scores": base}]}
    )


async def test_openai_maps_scores_to_decisions():
    for scores, expected in [
        ({}, "ALLOW"),
        ({"harassment": 0.75}, "WARN"),
        ({"harassment__threatening": 0.9}, "BLOCK"),
        # Insulto fuerte sin amenaza: no llega a BLOCK.
        ({"harassment": 0.95}, "WARN"),
    ]:
        classifier = openai_classifier(lambda request, s=scores: scores_response(**s))
        prediction = await classifier.predict("texto")
        assert prediction.decision == expected, scores
        assert prediction.model_version == "omni-moderation-2024-09-26"
        await classifier.aclose()


async def test_openai_errors_raise_unavailable():
    from app.service.classifier import ClassifierUnavailable

    classifier = openai_classifier(lambda request: httpx.Response(429, json={"error": "rate limit"}))
    with pytest.raises(ClassifierUnavailable):
        await classifier.predict("texto")
    await classifier.aclose()
