from email.message import EmailMessage
from email.utils import make_msgid

import aiosmtplib


class SmtpDeliveryError(Exception):
    """Error base al entregar por SMTP."""


class TransientSmtpError(SmtpDeliveryError):
    """Fallo temporal de red, timeout o código SMTP 4xx (reintentable)."""


class PermanentSmtpError(SmtpDeliveryError):
    """Rechazo definitivo SMTP 5xx o destinatario inválido (no reintentable)."""


class SmtpClient:
    """Cliente asíncrono SMTP compatible con Mailpit (sin TLS) y proveedores en producción (TLS/STARTTLS)."""

    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: str = "",
        password: str = "",
        use_tls: bool = False,
        start_tls: bool = False,
        timeout: float = 10.0,
        smtp_from: str = "GeoPicto <no-reply@geopicto.org>",
        default_reply_to: str = "no-reply@geopicto.org",
    ):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.use_tls = use_tls
        self.start_tls = start_tls
        self.timeout = timeout
        self.smtp_from = smtp_from
        self.default_reply_to = default_reply_to

    def build_mime_message(
        self,
        *,
        to: str,
        subject: str,
        text_body: str,
        html_body: str,
        reply_to: str | None = None,
    ) -> tuple[EmailMessage, str]:
        msg = EmailMessage()
        message_id = make_msgid(domain="geopicto.org")
        msg["From"] = self.smtp_from
        msg["To"] = to
        msg["Subject"] = subject
        msg["Reply-To"] = reply_to or self.default_reply_to
        msg["Message-ID"] = message_id

        # Orden estándar RFC: primero texto plano y luego alternativa HTML.
        msg.set_content(text_body, subtype="plain", charset="utf-8")
        msg.add_alternative(html_body, subtype="html", charset="utf-8")
        return msg, message_id

    async def send(
        self,
        *,
        to: str,
        subject: str,
        text_body: str,
        html_body: str,
        reply_to: str | None = None,
    ) -> str:
        msg, message_id = self.build_mime_message(
            to=to,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
            reply_to=reply_to,
        )
        try:
            await aiosmtplib.send(
                msg,
                hostname=self.host,
                port=self.port,
                username=self.username or None,
                password=self.password or None,
                use_tls=self.use_tls,
                start_tls=self.start_tls,
                timeout=self.timeout,
            )
            return message_id
        except aiosmtplib.SMTPRecipientsRefused as exc:
            raise PermanentSmtpError(f"Destinatario rechazado por SMTP: {exc}") from exc
        except aiosmtplib.SMTPResponseException as exc:
            if 500 <= exc.code < 600:
                raise PermanentSmtpError(f"SMTP {exc.code}: {exc.message}") from exc
            raise TransientSmtpError(f"SMTP {exc.code}: {exc.message}") from exc
        except (
            aiosmtplib.SMTPException,
            TimeoutError,
            OSError,
            ConnectionError,
        ) as exc:
            raise TransientSmtpError(f"Fallo de conexión SMTP: {exc}") from exc

    async def ping(self) -> bool:
        """Verifica conectividad con el servidor SMTP (EHLO/STARTTLS + NOOP) sin enviar correo."""
        client = aiosmtplib.SMTP(
            hostname=self.host,
            port=self.port,
            use_tls=self.use_tls,
            start_tls=self.start_tls,
            timeout=min(self.timeout, 5.0),
        )
        try:
            await client.connect()
            code, _ = await client.noop()
            await client.quit()
            return 200 <= code < 300
        except Exception:
            try:
                client.close()
            except Exception:
                pass
            return False
