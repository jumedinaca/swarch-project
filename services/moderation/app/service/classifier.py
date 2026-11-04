import logging
from dataclasses import dataclass, field
from typing import Protocol

import httpx

logger = logging.getLogger(__name__)

# Categorías de OpenAI que bloquean cuando superan BLOCK_THRESHOLD. El resto
# (insultos, odio sin amenaza, contenido sexual, etc.) solo llega a WARN.
BLOCK_CATEGORIES = {
    "harassment/threatening",
    "hate/threatening",
    "violence",
    "violence/graphic",
    "sexual/minors",
    "self-harm/instructions",
    "illicit/violent",
}


@dataclass(frozen=True)
class Prediction:
    decision: str  # ALLOW | WARN | BLOCK
    confidence: float
    model_version: str
    # Categorías que superaron el umbral, para la auditoría.
    categories: list[str] = field(default_factory=list)


class ClassifierUnavailable(Exception):
    """El clasificador falló o tardó demasiado: se decide solo con reglas."""


class Classifier(Protocol):
    name: str

    async def predict(self, text: str) -> Prediction: ...


class OpenAIModerationClassifier:
    """Clasificador basado en la API de moderación de OpenAI."""

    name = "openai"

    def __init__(
        self,
        api_key: str,
        *,
        model: str,
        base_url: str,
        timeout_seconds: float,
        block_threshold: float,
        warn_threshold: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.model = model
        self.block_threshold = block_threshold
        self.warn_threshold = warn_threshold
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout_seconds,
            transport=transport,
        )

    async def predict(self, text: str) -> Prediction:
        try:
            response = await self._client.post("/moderations", json={"model": self.model, "input": text})
            response.raise_for_status()
            body = response.json()
            result = body["results"][0]
            scores: dict[str, float] = result["category_scores"]
        except (httpx.HTTPError, ValueError, KeyError, IndexError) as exc:
            raise ClassifierUnavailable(type(exc).__name__) from exc

        return self._decide(scores, body.get("model", self.model))

    def _decide(self, scores: dict[str, float], model_version: str) -> Prediction:
        block = {c: s for c, s in scores.items() if c in BLOCK_CATEGORIES and s >= self.block_threshold}
        if block:
            return Prediction("BLOCK", max(block.values()), model_version, sorted(block))
        warn = {c: s for c, s in scores.items() if s >= self.warn_threshold}
        if warn:
            return Prediction("WARN", max(warn.values()), model_version, sorted(warn))
        # Confianza de ALLOW: qué tan lejos está la categoría más alta.
        top = max(scores.values(), default=0.0)
        return Prediction("ALLOW", round(1.0 - top, 4), model_version)

    async def aclose(self) -> None:
        await self._client.aclose()
