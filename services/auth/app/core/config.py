from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    port: int = 8000

    jwt_secret: str = Field(min_length=32)
    jwt_algorithm: str = "HS256"
    jwt_issuer: str = "geopicto-auth"
    # Corto a propósito: el gateway valida la firma localmente y no consulta la sesión,
    # así que un token sigue sirviendo tras el logout hasta que expira. El frontend
    # renueva el token con el refresh token.
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    # Tolerancia a desfases de reloj entre contenedores al validar exp/iat
    jwt_leeway_seconds: int = 10

    max_failed_login_attempts: int = 5
    lockout_minutes: int = 15

    # Lista separada por comas. Vacío = sin CORS (el API Gateway lo centraliza).
    cors_origins: str = ""

    # Redis compartido con el gateway para la blacklist distribuida de sesiones
    # revocadas (Escenario 5). Si está vacío, la blacklist queda deshabilitada
    # y el logout solo revoca la sesión en PostgreSQL (comportamiento anterior).
    redis_url: str = ""
    # Interruptor del patrón. Debe tener el mismo valor en auth y gateway:
    # con false, ninguno de los dos usa Redis y el token sigue siendo aceptado
    # por el gateway hasta que expira (útil para demostrar la vulnerabilidad).
    token_blacklist_enabled: bool = True
    token_blacklist_prefix: str = "auth:revoked:"
    redis_timeout_seconds: float = 0.5

    # Si está vacío, los eventos no se publican (el servicio sigue funcionando).
    rabbitmq_url: str = ""
    rabbitmq_exchange: str = "geopicto.events"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
