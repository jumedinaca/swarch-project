import logging
import re
from typing import Any

import structlog

EMAIL_IN_TEXT_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")

REDACTED_KEYS = frozenset(
    {
        "body",
        "html",
        "html_body",
        "text",
        "text_body",
        "variables",
        "raw_body",
        "password",
        "smtp_password",
        "internal_token",
    }
)

EMAIL_KEYS = frozenset({"email", "to", "recipient", "reply_to", "replyTo"})


def normalize_email(email: str) -> str:
    """Normaliza una dirección de correo para validación, límites e idempotencia."""
    return email.strip().lower()


def mask_email(email: str | None) -> str:
    """Enmascara un correo electrónico como `j***@dominio.com`."""
    if not email:
        return "***"
    cleaned = email.strip().lower()
    if "@" not in cleaned:
        return f"{cleaned[0]}***" if cleaned else "***"
    local, domain = cleaned.split("@", 1)
    if not local:
        return f"***@{domain}" if domain else "***"
    if not domain:
        return f"{local[0]}***"
    return f"{local[0]}***@{domain}"


def mask_emails_in_text(text: str) -> str:
    """Reemplaza cualquier correo completo presente en un texto por su versión enmascarada."""
    return EMAIL_IN_TEXT_RE.sub(lambda m: mask_email(m.group(0)), text)


def sanitize_error(
    err: BaseException | str,
    recipient: str | None = None,
    max_len: int = 500,
) -> str:
    """Limpia datos sensibles/correos completos y trunca el mensaje de error."""
    raw = str(err) if not isinstance(err, str) else err
    if not raw:
        raw = err.__class__.__name__ if isinstance(err, BaseException) else "unknown_error"

    if recipient:
        masked = mask_email(recipient)
        raw = raw.replace(recipient, masked).replace(recipient.strip().lower(), masked)

    sanitized = mask_emails_in_text(raw)
    sanitized = re.sub(r"[\r\n\t]+", " ", sanitized)
    sanitized = re.sub(r"\s{2,}", " ", sanitized).strip()

    if len(sanitized) > max_len:
        return sanitized[: max_len - 3] + "..."
    return sanitized


def scrub_sensitive_processor(_: Any, __: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    """Procesador structlog que impide volcar cuerpos o correos completos en logs."""
    cleaned: dict[str, Any] = {}
    for key, value in event_dict.items():
        if key in REDACTED_KEYS:
            continue
        if key in EMAIL_KEYS and isinstance(value, str):
            cleaned[key] = mask_email(value)
        elif key == "provider_message_id":
            cleaned[key] = value
        elif isinstance(value, str):
            cleaned[key] = mask_emails_in_text(value)
        else:
            cleaned[key] = value
    return cleaned


def configure_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(format="%(message)s", level=level)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            scrub_sensitive_processor,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        cache_logger_on_first_use=False,
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
