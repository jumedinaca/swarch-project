import uuid
from dataclasses import dataclass
from typing import Literal, Protocol

from app.core.config import Settings
from app.core.logging import get_logger, sanitize_error
from app.core.ratelimit import SlidingWindowRateLimiter
from app.domain.models import utcnow
from app.messaging.events import (
    EmailDeliveryJob,
    EmailFailedEvent,
    EmailFailedPayload,
    EmailRequestedEvent,
    EmailRequestedPayload,
    EmailSentEvent,
    EmailSentPayload,
)
from app.repository.email_repository import EmailRepository
from app.schema.email_schema import EmailQueuedOut, EmailStatusOut, InternalEmailCreateRequest
from app.service.smtp_client import PermanentSmtpError, SmtpClient, TransientSmtpError
from app.service.template_renderer import TemplateNotRegisteredError, TemplateRenderer

logger = get_logger(__name__)

DeliveryAction = Literal[
    "sent",
    "duplicate",
    "retry",
    "dlq",
    "failed_permanent",
    "defer_global_limit",
]


@dataclass(frozen=True)
class DeliveryResult:
    action: DeliveryAction
    email_id: uuid.UUID
    status: str
    error: str | None = None
    wait_seconds: float = 0.0
    next_retry_count: int = 0


class EventPublisherProtocol(Protocol):
    async def publish(self, event: EmailRequestedEvent | EmailSentEvent | EmailFailedEvent) -> None: ...


class JobDispatcherProtocol(Protocol):
    async def dispatch_requested(self, job: EmailDeliveryJob) -> None: ...


class EmailError(Exception):
    def __init__(self, status_code: int, code: str, message: str, headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers


class EmailService:
    def __init__(
        self,
        *,
        settings: Settings,
        repo: EmailRepository,
        renderer: TemplateRenderer,
        smtp: SmtpClient,
        global_limiter: SlidingWindowRateLimiter,
        publisher: EventPublisherProtocol | None = None,
        dispatcher: JobDispatcherProtocol | None = None,
    ):
        self.settings = settings
        self.repo = repo
        self.renderer = renderer
        self.smtp = smtp
        self.global_limiter = global_limiter
        self.publisher = publisher
        self.dispatcher = dispatcher

    async def enqueue_internal_email(self, req: InternalEmailCreateRequest) -> EmailQueuedOut:
        """
        Registra un envío desde `POST /internal/emails` de forma idempotente
        y lo despacha asíncronamente por cola (nunca envía SMTP en el request).
        """
        assert req.subject is not None
        email_id = req.email_id or uuid.uuid4()
        idempotency_key = req.idempotency_key or str(email_id)

        existing = await self.repo.get_by_idempotency_key(idempotency_key)
        if existing is not None:
            logger.info(
                "email.enqueue.idempotent_hit",
                email_id=str(existing.id),
                idempotency_key=idempotency_key,
                recipient=existing.recipient,
                status=existing.status,
            )
            return EmailQueuedOut(email_id=existing.id, status=existing.status)

        recent_count = await self.repo.count_recent_to_recipient(req.to, window_seconds=3600)
        if recent_count >= self.settings.rate_limit_per_recipient_per_hour:
            raise EmailError(
                429,
                "rate_limited",
                f"Se alcanzó el límite de {self.settings.rate_limit_per_recipient_per_hour} correos por hora para este destinatario.",
                headers={"Retry-After": "3600"},
            )

        row, created = await self.repo.create_or_get(
            email_id=email_id,
            idempotency_key=idempotency_key,
            recipient=req.to,
            template=req.template,
            subject=req.subject,
        )
        if not created:
            return EmailQueuedOut(email_id=row.id, status=row.status)

        job = EmailDeliveryJob(
            email_id=row.id,
            to=req.to,
            template=req.template,
            subject=req.subject,
            variables=req.variables,
            idempotency_key=idempotency_key,
            reply_to=req.reply_to,
        )

        if self.dispatcher is not None:
            await self.dispatcher.dispatch_requested(job)

        logger.info(
            "email.queued",
            email_id=str(row.id),
            idempotency_key=idempotency_key,
            template=req.template,
            recipient=req.to,
        )
        return EmailQueuedOut(email_id=row.id, status=row.status)

    async def get_email_status(self, email_id: uuid.UUID) -> EmailStatusOut:
        row = await self.repo.get_by_id(email_id)
        if row is None:
            raise EmailError(404, "email_not_found", "No se encontró el envío solicitado.")
        return EmailStatusOut.from_orm_masked(row)

    async def process_job(self, job: EmailDeliveryJob, retry_count: int = 0) -> DeliveryResult:
        """
        Ejecuta un intento de envío aplicando idempotencia, límites por destinatario/global,
        renderizado seguro, entrega SMTP, backoff escalonado y transición a DLQ.
        """
        row, _ = await self.repo.create_or_get(
            email_id=job.email_id,
            idempotency_key=job.idempotency_key,
            recipient=job.to,
            template=job.template,
            subject=job.subject,
        )

        # Idempotencia: si ya fue enviado o se está enviando, se confirma sin reenviar.
        if row.status in ("SENT", "SENDING"):
            logger.info(
                "email.duplicate_skipped",
                email_id=str(row.id),
                idempotency_key=job.idempotency_key,
                recipient=job.to,
                status=row.status,
            )
            return DeliveryResult(action="duplicate", email_id=row.id, status=row.status)

        if row.status in ("FAILED", "DLQ") and retry_count == 0:
            logger.info(
                "email.terminal_duplicate_skipped",
                email_id=str(row.id),
                idempotency_key=job.idempotency_key,
                status=row.status,
            )
            return DeliveryResult(action="duplicate", email_id=row.id, status=row.status)

        # Límite por destinatario: 5 correos/hora (configurable).
        recent_count = await self.repo.count_recent_to_recipient(job.to, window_seconds=3600)
        if recent_count >= self.settings.rate_limit_per_recipient_per_hour:
            reason = (
                f"Límite por destinatario excedido "
                f"({self.settings.rate_limit_per_recipient_per_hour} correos/hora)."
            )
            await self.repo.mark_terminal_failure(row, reason, dlq=False)
            logger.warning(
                "email.recipient_rate_limited",
                email_id=str(row.id),
                recipient=job.to,
                limit=self.settings.rate_limit_per_recipient_per_hour,
            )
            await self._emit_failed(job, row.status, row.attempts, reason)
            return DeliveryResult(action="failed_permanent", email_id=row.id, status=row.status, error=reason)

        # Renderizado de plantilla registrada (fallos de validación no se reintentan).
        try:
            rendered = self.renderer.render(job.template, job.subject, job.variables)
        except (TemplateNotRegisteredError, ValueError) as exc:
            reason = sanitize_error(exc, recipient=job.to)
            await self.repo.mark_terminal_failure(row, reason, dlq=False)
            logger.error(
                "email.render_failed",
                email_id=str(row.id),
                template=job.template,
                recipient=job.to,
                error=reason,
            )
            await self._emit_failed(job, row.status, row.attempts, reason)
            return DeliveryResult(action="failed_permanent", email_id=row.id, status=row.status, error=reason)

        # Límite global: 100 correos/minuto (configurable). Si se llena, se difiere sin perder el mensaje.
        wait_global = self.global_limiter.try_acquire("global")
        if wait_global is not None:
            logger.warning(
                "email.global_rate_limited",
                email_id=str(row.id),
                wait_seconds=wait_global,
            )
            return DeliveryResult(
                action="defer_global_limit",
                email_id=row.id,
                status="QUEUED",
                wait_seconds=wait_global,
                next_retry_count=retry_count,
            )

        await self.repo.mark_sending(row)

        try:
            provider_msg_id = await self.smtp.send(
                to=job.to,
                subject=job.subject,
                text_body=rendered.text_body,
                html_body=rendered.html_body,
                reply_to=job.reply_to or self.settings.default_reply_to,
            )
        except PermanentSmtpError as exc:
            reason = sanitize_error(exc, recipient=job.to)
            await self.repo.mark_terminal_failure(row, reason, dlq=False)
            logger.error(
                "email.smtp_permanent_failure",
                email_id=str(row.id),
                recipient=job.to,
                attempts=row.attempts,
                error=reason,
            )
            await self._emit_failed(job, row.status, row.attempts, reason)
            return DeliveryResult(action="failed_permanent", email_id=row.id, status=row.status, error=reason)
        except (TransientSmtpError, Exception) as exc:
            reason = sanitize_error(exc, recipient=job.to)
            delays = self.settings.retry_delays_list
            if retry_count < len(delays):
                delay_s = delays[retry_count]
                await self.repo.mark_retry_queued(row, reason)
                logger.warning(
                    "email.smtp_retry_scheduled",
                    email_id=str(row.id),
                    recipient=job.to,
                    attempt=row.attempts,
                    next_retry=retry_count + 1,
                    delay_seconds=delay_s,
                    error=reason,
                )
                return DeliveryResult(
                    action="retry",
                    email_id=row.id,
                    status="QUEUED",
                    error=reason,
                    wait_seconds=delay_s,
                    next_retry_count=retry_count + 1,
                )

            await self.repo.mark_terminal_failure(row, reason, dlq=True)
            logger.error(
                "email.moved_to_dlq",
                email_id=str(row.id),
                recipient=job.to,
                attempts=row.attempts,
                error=reason,
            )
            await self._emit_failed(job, row.status, row.attempts, reason)
            return DeliveryResult(action="dlq", email_id=row.id, status="DLQ", error=reason)

        await self.repo.mark_sent(row, provider_msg_id)
        logger.info(
            "email.sent",
            email_id=str(row.id),
            template=job.template,
            recipient=job.to,
            attempts=row.attempts,
            provider_message_id=provider_msg_id,
        )
        await self._emit_sent(job, provider_msg_id)
        return DeliveryResult(action="sent", email_id=row.id, status="SENT")

    async def _emit_sent(self, job: EmailDeliveryJob, provider_message_id: str | None) -> None:
        if not self.settings.publish_status_events or self.publisher is None:
            return
        event = EmailSentEvent(
            correlation_id=job.correlation_id,
            causation_id=job.causation_id,
            payload=EmailSentPayload(
                email_id=job.email_id,
                template=job.template,
                idempotency_key=job.idempotency_key,
                provider_message_id=provider_message_id,
                sent_at=utcnow(),
            ),
        )
        try:
            await self.publisher.publish(event)
        except Exception as exc:
            logger.warning("email.publish_sent_event_failed", email_id=str(job.email_id), error=sanitize_error(exc))

    async def _emit_failed(self, job: EmailDeliveryJob, status: str, attempts: int, reason: str) -> None:
        if not self.settings.publish_status_events or self.publisher is None:
            return
        event = EmailFailedEvent(
            correlation_id=job.correlation_id,
            causation_id=job.causation_id,
            payload=EmailFailedPayload(
                email_id=job.email_id,
                template=job.template,
                idempotency_key=job.idempotency_key,
                status=status,
                attempts=attempts,
                reason=reason,
                failed_at=utcnow(),
            ),
        )
        try:
            await self.publisher.publish(event)
        except Exception as exc:
            logger.warning("email.publish_failed_event_failed", email_id=str(job.email_id), error=sanitize_error(exc))


def job_to_requested_event(job: EmailDeliveryJob) -> EmailRequestedEvent:
    return EmailRequestedEvent(
        correlation_id=job.correlation_id,
        causation_id=job.causation_id,
        payload=EmailRequestedPayload(
            email_id=job.email_id,
            to=job.to,
            template=job.template,
            subject=job.subject,
            variables=job.variables,
            idempotency_key=job.idempotency_key,
            reply_to=job.reply_to,
            requested_at=utcnow(),
        ),
    )
