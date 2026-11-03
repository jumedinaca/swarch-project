from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    port: int = 8000

    # Token compartido para proteger los endpoints administrativos/internos.
    internal_token: str = Field(default="dev-internal-token", min_length=1)

    # Broker RabbitMQ. Si está vacío, el servicio procesa envíos de /internal/emails
    # en una cola asíncrona local en memoria.
    rabbitmq_url: str = ""
    rabbitmq_exchange: str = "geopicto.events"
    publish_status_events: bool = True

    # Configuración SMTP (Mailpit sin TLS en local; TLS/STARTTLS en producción).
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = False
    smtp_starttls: bool = False
    smtp_timeout_seconds: float = 10.0
    smtp_from: str = "GeoPicto <no-reply@geopicto.org>"
    default_reply_to: str = "no-reply@geopicto.org"

    # Límites de tasa y políticas de reintento / retención.
    rate_limit_per_recipient_per_hour: int = 5
    global_rate_limit_per_minute: int = 100
    retry_delays_seconds: str = "10,60,300"
    retention_days: int = 30
    retention_sweep_seconds: int = 86400

    @property
    def retry_delays_list(self) -> list[float]:
        values = [part.strip() for part in self.retry_delays_seconds.split(",") if part.strip()]
        return [float(v) for v in values] if values else [10.0, 60.0, 300.0]


@lru_cache
def get_settings() -> Settings:
    return Settings()
