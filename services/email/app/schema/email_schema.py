import unicodedata
import uuid
from datetime import datetime, timezone
from typing import Any, Literal
from urllib.parse import urlparse

from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.core.logging import mask_email, normalize_email

RegisteredTemplate = Literal["welcome", "generic"]
REGISTERED_TEMPLATES: frozenset[str] = frozenset({"welcome", "generic"})


def _has_control_chars(value: str, allowed: str = "") -> bool:
    return any(unicodedata.category(c) == "Cc" and c not in allowed for c in value)


def validate_clean_email(raw: str) -> str:
    if not isinstance(raw, str):
        raise ValueError("El correo electrónico no es válido.")
    candidate = normalize_email(raw)
    if not candidate or len(candidate) > 320 or _has_control_chars(candidate):
        raise ValueError("El correo electrónico debe ser válido y tener máximo 320 caracteres.")
    try:
        info = validate_email(candidate, check_deliverability=False)
    except EmailNotValidError as exc:
        raise ValueError("El correo electrónico no tiene un formato válido.") from exc
    normalized = info.normalized.lower()
    if len(normalized) > 320:
        raise ValueError("El correo electrónico no puede superar 320 caracteres.")
    return normalized


def validate_http_url(raw: str) -> str:
    value = raw.strip()
    if not value or len(value) > 2048 or _has_control_chars(value) or any(c.isspace() for c in value):
        raise ValueError("ctaUrl debe ser un enlace absoluto http o https válido.")
    parsed = urlparse(value)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.netloc:
        raise ValueError("ctaUrl debe usar exclusivamente http o https y ser un enlace absoluto.")
    return value


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


# ==========================================
# Contratos de variables por plantilla
# ==========================================


class WelcomeVariables(CamelModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    username: str

    @field_validator("username")
    @classmethod
    def check_username(cls, value: str) -> str:
        cleaned = value.strip()
        if not 1 <= len(cleaned) <= 100 or _has_control_chars(cleaned):
            raise ValueError("username debe tener entre 1 y 100 caracteres sin caracteres de control.")
        return cleaned


class GenericVariables(CamelModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    title: str
    body: str
    cta_url: str | None = None
    cta_label: str | None = None

    @field_validator("title")
    @classmethod
    def check_title(cls, value: str) -> str:
        cleaned = value.strip()
        if not 1 <= len(cleaned) <= 200 or _has_control_chars(cleaned):
            raise ValueError("title debe tener entre 1 y 200 caracteres sin saltos de línea.")
        return cleaned

    @field_validator("body")
    @classmethod
    def check_body(cls, value: str) -> str:
        cleaned = value.replace("\r\n", "\n").strip()
        if not 1 <= len(cleaned) <= 10000 or _has_control_chars(cleaned, allowed="\n\t"):
            raise ValueError("body debe tener entre 1 y 10000 caracteres.")
        return cleaned

    @field_validator("cta_url")
    @classmethod
    def check_cta_url(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        return validate_http_url(value)

    @field_validator("cta_label")
    @classmethod
    def check_cta_label(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        cleaned = value.strip()
        if not 1 <= len(cleaned) <= 80 or _has_control_chars(cleaned):
            raise ValueError("ctaLabel debe tener entre 1 y 80 caracteres.")
        return cleaned


def default_welcome_subject(username: str) -> str:
    prefix = "¡Bienvenido a GeoPicto, "
    suffix = "!"
    max_username = 200 - len(prefix) - len(suffix)
    return f"{prefix}{username[:max_username]}{suffix}"


def validate_template_variables(template: str, variables: dict[str, Any]) -> dict[str, Any]:
    if template not in REGISTERED_TEMPLATES:
        raise ValueError(f"La plantilla '{template}' no está registrada.")
    if not isinstance(variables, dict):
        raise ValueError("Las variables de la plantilla deben ser un objeto JSON.")
    if template == "welcome":
        parsed = WelcomeVariables.model_validate(variables)
        return {"username": parsed.username}
    parsed_generic = GenericVariables.model_validate(variables)
    cta_label = parsed_generic.cta_label
    if parsed_generic.cta_url and not cta_label:
        cta_label = "Abrir en GeoPicto"
    return {
        "title": parsed_generic.title,
        "body": parsed_generic.body,
        "cta_url": parsed_generic.cta_url,
        "cta_label": cta_label,
    }


# ==========================================
# Requests / Responses HTTP internas
# ==========================================


class InternalEmailCreateRequest(CamelModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    email_id: uuid.UUID | None = None
    to: str
    template: str
    subject: str | None = None
    variables: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = None
    reply_to: str | None = None

    @field_validator("to")
    @classmethod
    def check_to(cls, value: str) -> str:
        return validate_clean_email(value)

    @field_validator("template")
    @classmethod
    def check_template(cls, value: str) -> str:
        cleaned = value.strip()
        if cleaned not in REGISTERED_TEMPLATES:
            raise ValueError(f"Plantilla no registrada: '{cleaned}'.")
        return cleaned

    @field_validator("subject")
    @classmethod
    def check_subject(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not 1 <= len(cleaned) <= 200 or _has_control_chars(cleaned):
            raise ValueError("El asunto debe tener entre 1 y 200 caracteres sin saltos de línea.")
        return cleaned

    @field_validator("idempotency_key")
    @classmethod
    def check_idempotency_key(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        cleaned = value.strip()
        if not 1 <= len(cleaned) <= 160 or _has_control_chars(cleaned):
            raise ValueError("idempotencyKey debe tener entre 1 y 160 caracteres.")
        return cleaned

    @field_validator("reply_to")
    @classmethod
    def check_reply_to(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        return validate_clean_email(value)

    @model_validator(mode="after")
    def check_variables_and_subject(self) -> "InternalEmailCreateRequest":
        validated_vars = validate_template_variables(self.template, self.variables)
        self.variables = validated_vars
        if self.subject is None:
            if self.template == "welcome":
                self.subject = default_welcome_subject(validated_vars["username"])
            else:
                raise ValueError("El asunto es obligatorio para esta plantilla.")
        return self


class EmailQueuedOut(CamelModel):
    email_id: uuid.UUID
    status: str


class EmailStatusOut(CamelModel):
    email_id: uuid.UUID
    idempotency_key: str | None
    recipient: str
    template: str
    subject: str
    status: str
    attempts: int
    provider_message_id: str | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime
    sent_at: datetime | None

    @field_validator("created_at", "updated_at", "sent_at")
    @classmethod
    def as_utc(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

    @classmethod
    def from_orm_masked(cls, row: Any) -> "EmailStatusOut":
        return cls(
            email_id=row.id,
            idempotency_key=row.idempotency_key,
            recipient=mask_email(row.recipient),
            template=row.template,
            subject=row.subject,
            status=row.status,
            attempts=row.attempts,
            provider_message_id=row.provider_message_id,
            last_error=row.last_error,
            created_at=row.created_at,
            updated_at=row.updated_at,
            sent_at=row.sent_at,
        )
