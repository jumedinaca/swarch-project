from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4, uuid5

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.schema.email_schema import (
    REGISTERED_TEMPLATES,
    default_welcome_subject,
    validate_clean_email,
    validate_template_variables,
)

WELCOME_UUID_NAMESPACE = UUID("6ba7b811-9dad-11d1-80b4-00c04fd430c8")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class EventModel(BaseModel):
    """Sobre común de eventos en camelCase."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


class InvalidEventError(Exception):
    """Evento malformado o con datos permanentemente inválidos (no debe reintentarse)."""


# ==========================================
# Unidad interna de trabajo de envío
# ==========================================


class EmailDeliveryJob(EventModel):
    email_id: UUID
    to: str
    template: str
    subject: str
    variables: dict[str, Any]
    idempotency_key: str
    reply_to: str | None = None
    correlation_id: UUID = Field(default_factory=uuid4)
    causation_id: UUID | None = None


# ==========================================
# Eventos consumidos
# ==========================================


class UserRegisteredPayload(EventModel):
    user_id: UUID
    username: str
    email: str
    registered_at: datetime | None = None

    @field_validator("email")
    @classmethod
    def check_email(cls, value: str) -> str:
        return validate_clean_email(value)

    @field_validator("username")
    @classmethod
    def check_username(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("username vacío en user.registered.v1")
        return cleaned[:100]


class EmailRequestedPayload(EventModel):
    email_id: UUID | None = None
    to: str
    template: str
    subject: str | None = None
    variables: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = None
    reply_to: str | None = None
    requested_at: datetime | None = None

    @field_validator("to")
    @classmethod
    def check_to(cls, value: str) -> str:
        return validate_clean_email(value)

    @field_validator("template")
    @classmethod
    def check_template(cls, value: str) -> str:
        cleaned = value.strip()
        if cleaned not in REGISTERED_TEMPLATES:
            raise ValueError(f"Plantilla '{cleaned}' no registrada.")
        return cleaned

    @field_validator("subject")
    @classmethod
    def check_subject(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not 1 <= len(cleaned) <= 200 or "\r" in cleaned or "\n" in cleaned:
            raise ValueError("Asunto inválido o mayor a 200 caracteres.")
        return cleaned

    @field_validator("reply_to")
    @classmethod
    def check_reply_to(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        return validate_clean_email(value)

    @model_validator(mode="after")
    def finalize(self) -> "EmailRequestedPayload":
        self.variables = validate_template_variables(self.template, self.variables)
        if self.subject is None:
            if self.template == "welcome":
                self.subject = default_welcome_subject(self.variables["username"])
            else:
                raise ValueError("subject es obligatorio para la plantilla solicitada.")
        if self.email_id is None:
            if self.idempotency_key:
                self.email_id = uuid5(WELCOME_UUID_NAMESPACE, f"geopicto:email:{self.idempotency_key.strip()}")
            else:
                self.email_id = uuid4()
        if not self.idempotency_key or not self.idempotency_key.strip():
            self.idempotency_key = str(self.email_id)
        else:
            self.idempotency_key = self.idempotency_key.strip()
            if len(self.idempotency_key) > 160:
                raise ValueError("idempotencyKey supera 160 caracteres.")
        return self


class EmailRequestedEvent(EventModel):
    event_id: UUID = Field(default_factory=uuid4)
    event_type: str = "email.requested.v1"
    version: int = 1
    occurred_at: datetime = Field(default_factory=utcnow)
    producer: str = "email-api"
    correlation_id: UUID = Field(default_factory=uuid4)
    causation_id: UUID | None = None
    payload: EmailRequestedPayload


# ==========================================
# Eventos publicados (opcionales)
# ==========================================


class EmailSentPayload(EventModel):
    email_id: UUID
    template: str
    idempotency_key: str
    provider_message_id: str | None = None
    sent_at: datetime


class EmailSentEvent(EventModel):
    event_id: UUID = Field(default_factory=uuid4)
    event_type: str = "email.sent.v1"
    version: int = 1
    occurred_at: datetime = Field(default_factory=utcnow)
    producer: str = "email"
    correlation_id: UUID = Field(default_factory=uuid4)
    causation_id: UUID | None = None
    payload: EmailSentPayload


class EmailFailedPayload(EventModel):
    email_id: UUID
    template: str
    idempotency_key: str
    status: str
    attempts: int
    reason: str
    failed_at: datetime


class EmailFailedEvent(EventModel):
    event_id: UUID = Field(default_factory=uuid4)
    event_type: str = "email.failed.v1"
    version: int = 1
    occurred_at: datetime = Field(default_factory=utcnow)
    producer: str = "email"
    correlation_id: UUID = Field(default_factory=uuid4)
    causation_id: UUID | None = None
    payload: EmailFailedPayload


def parse_incoming_event(event_type: str, envelope: dict[str, Any]) -> EmailDeliveryJob:
    """Convierte un sobre de evento entrante en un `EmailDeliveryJob` validado."""
    try:
        raw_payload = envelope["payload"]
        correlation_raw = envelope.get("correlationId")
        event_id_raw = envelope.get("eventId")
        correlation_id = UUID(str(correlation_raw)) if correlation_raw else uuid4()
        causation_id = UUID(str(event_id_raw)) if event_id_raw else None

        if event_type == "user.registered.v1":
            reg = UserRegisteredPayload.model_validate(raw_payload)
            idempotency_key = f"welcome:{reg.user_id}"
            email_id = uuid5(WELCOME_UUID_NAMESPACE, f"geopicto:{idempotency_key}")
            subject = default_welcome_subject(reg.username)
            variables = validate_template_variables("welcome", {"username": reg.username})
            return EmailDeliveryJob(
                email_id=email_id,
                to=reg.email,
                template="welcome",
                subject=subject,
                variables=variables,
                idempotency_key=idempotency_key,
                reply_to=None,
                correlation_id=correlation_id,
                causation_id=causation_id,
            )

        if event_type == "email.requested.v1":
            req = EmailRequestedPayload.model_validate(raw_payload)
            assert req.email_id is not None
            assert req.subject is not None
            assert req.idempotency_key is not None
            return EmailDeliveryJob(
                email_id=req.email_id,
                to=req.to,
                template=req.template,
                subject=req.subject,
                variables=req.variables,
                idempotency_key=req.idempotency_key,
                reply_to=req.reply_to,
                correlation_id=correlation_id,
                causation_id=causation_id,
            )

        raise InvalidEventError(f"Tipo de evento no soportado: {event_type}")
    except InvalidEventError:
        raise
    except (KeyError, TypeError, ValueError, ValidationError) as exc:
        raise InvalidEventError(str(exc)) from exc
