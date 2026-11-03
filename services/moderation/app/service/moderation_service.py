import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.domain.models import ModerationDecision
from app.messaging.events import ModerationCompletedEvent, ModerationCompletedPayload
from app.repository.decision_repository import DecisionRepository
from app.service.classifier import Classifier, ClassifierUnavailable, Prediction
from app.service.normalize import normalize
from app.service.rules import RuleEngine

if TYPE_CHECKING:
    from app.messaging.publisher import ModerationEventPublisher

logger = logging.getLogger(__name__)

HISTORY_WINDOW = timedelta(hours=24)
WARNS_BEFORE_BLOCK = 3


@dataclass(frozen=True)
class ModerationRequest:
    message_id: uuid.UUID
    author_id: uuid.UUID
    content: str
    message_version: int = 1


@dataclass(frozen=True)
class DecisionResult:
    decision: str
    confidence: float | None
    reasons: list[str]
    model_version: str | None
    rule_version: str
    degraded: bool
    latency_ms: int


def _category_reason(category: str) -> str:
    # "harassment/threatening" -> "CATEGORY_HARASSMENT_THREATENING"
    return "CATEGORY_" + category.upper().replace("/", "_").replace("-", "_")


class ModerationService:
    def __init__(
        self,
        db: AsyncSession,
        settings: Settings,
        rules: RuleEngine,
        classifier: Classifier | None,
        publisher: "ModerationEventPublisher | None",
    ):
        self.db = db
        self.settings = settings
        self.rules = rules
        self.classifier = classifier
        self.publisher = publisher
        self.repository = DecisionRepository(db)

    async def evaluate(self, request: ModerationRequest) -> DecisionResult:
        """Decide sin guardar ni publicar. Lo usa POST /internal/moderate."""
        started = time.perf_counter()
        text = normalize(request.content, self.settings.max_content_chars)
        rule_result = self.rules.evaluate(text)
        prediction = await self._predict(text.plain)
        degraded = prediction is None

        reasons: list[str] = []
        confidence: float | None
        # Una regla dura manda sobre el modelo (README_P2 §3, combinación híbrida).
        if rule_result.block_reasons:
            decision, confidence = "BLOCK", 1.0
            reasons += rule_result.block_reasons
        elif prediction is not None and prediction.decision == "BLOCK":
            decision, confidence = "BLOCK", prediction.confidence
            reasons.append("MODEL_BLOCK")
        elif rule_result.warn_reasons or (prediction is not None and prediction.decision == "WARN"):
            decision = "WARN"
            reasons += rule_result.warn_reasons
            if prediction is not None and prediction.decision == "WARN":
                reasons.append("MODEL_WARN")
                confidence = prediction.confidence
            else:
                confidence = 1.0
        else:
            decision = "ALLOW"
            confidence = prediction.confidence if prediction is not None else None
            reasons.append("OK")

        if prediction is not None:
            reasons += [_category_reason(c) for c in prediction.categories]
        if degraded:
            reasons.append("MODEL_UNAVAILABLE")

        decision = await self._escalate(request.author_id, decision, reasons)

        return DecisionResult(
            decision=decision,
            confidence=confidence,
            reasons=reasons,
            model_version=prediction.model_version if prediction is not None else None,
            rule_version=self.rules.version,
            degraded=degraded,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )

    async def moderate(
        self,
        request: ModerationRequest,
        *,
        correlation_id: uuid.UUID | None = None,
        causation_id: uuid.UUID | None = None,
    ) -> ModerationDecision:
        """Decide, guarda la auditoría y publica moderation.completed.v1. Idempotente."""
        existing = await self.repository.get_for_version(request.message_id, request.message_version)
        if existing is None:
            result = await self.evaluate(request)
            record = ModerationDecision(
                message_id=request.message_id,
                message_version=request.message_version,
                author_id=request.author_id,
                decision=result.decision,
                confidence=result.confidence,
                reasons=result.reasons,
                model_version=result.model_version,
                rule_version=result.rule_version,
                degraded=result.degraded,
                latency_ms=result.latency_ms,
            )
            self.repository.add(record)
            try:
                await self.db.commit()
            except IntegrityError:
                # Otra entrega del mismo evento ganó la carrera: se usa su decisión.
                await self.db.rollback()
                existing = await self.repository.get_for_version(request.message_id, request.message_version)
                if existing is None:
                    raise
                record = existing
            else:
                # Sin contenido en los logs (README_P2 §3).
                logger.info(
                    "Decisión %s para messageId=%s v%s authorId=%s confianza=%s razones=%s degraded=%s",
                    record.decision,
                    record.message_id,
                    record.message_version,
                    record.author_id,
                    record.confidence,
                    record.reasons,
                    record.degraded,
                )
        else:
            # Reentrega: se vuelve a publicar por si la publicación anterior falló.
            record = existing

        await self._publish(record, correlation_id, causation_id)
        return record

    async def get_latest(self, message_id: uuid.UUID) -> ModerationDecision | None:
        return await self.repository.get_latest(message_id)

    async def _predict(self, text: str) -> Prediction | None:
        if self.classifier is None:
            return None
        try:
            # Timeout total, no por fase de la petición (README_P2 §7).
            return await asyncio.wait_for(
                self.classifier.predict(text), timeout=self.settings.openai_timeout_seconds
            )
        except (ClassifierUnavailable, TimeoutError) as exc:
            logger.warning("Clasificador %s no disponible (%s); solo reglas.", self.classifier.name, exc)
            return None

    async def _escalate(self, author_id: uuid.UUID, decision: str, reasons: list[str]) -> str:
        """Escalamiento por historial del autor (README_P2 §3)."""
        if decision == "BLOCK":
            return decision
        since = datetime.now(timezone.utc) - HISTORY_WINDOW
        counts = await self.repository.count_by_decision_since(author_id, since)
        if counts.get("WARN", 0) >= WARNS_BEFORE_BLOCK or (decision == "WARN" and counts.get("BLOCK", 0) >= 1):
            reasons.append("AUTHOR_ESCALATION")
            return "BLOCK"
        return decision

    async def _publish(
        self,
        record: ModerationDecision,
        correlation_id: uuid.UUID | None,
        causation_id: uuid.UUID | None,
    ) -> None:
        if self.publisher is None:
            return
        event = ModerationCompletedEvent(
            correlation_id=correlation_id or uuid.uuid4(),
            causation_id=causation_id,
            payload=ModerationCompletedPayload(
                message_id=record.message_id,
                author_id=record.author_id,
                message_version=record.message_version,
                decision=record.decision,
                confidence=record.confidence,
                reasons=list(record.reasons),
                model_version=record.model_version,
                rule_version=record.rule_version,
                degraded=record.degraded,
                decided_at=record.created_at,
            ),
        )
        await self.publisher.publish(event)
