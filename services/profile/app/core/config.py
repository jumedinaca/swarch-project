from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    port: int = 8000

    # Mismo secreto y emisor que auth y el API Gateway: el servicio vuelve a
    # validar el JWT por su cuenta (ver docs/jwt-contract.md).
    jwt_secret: str = Field(min_length=32)
    jwt_algorithm: str = "HS256"
    jwt_issuer: str = "geopicto-auth"
    jwt_leeway_seconds: int = 10

    # Lista separada por comas. Vacío = sin CORS (el API Gateway lo centraliza).
    cors_origins: str = ""

    # Si está vacío, no se consumen ni publican eventos (el servicio sigue
    # funcionando y crea los perfiles de forma perezosa en GET /profiles/me).
    rabbitmq_url: str = ""
    rabbitmq_exchange: str = "geopicto.events"

    # Almacenamiento de avatares (S3 compatible). Si MINIO_ENDPOINT está vacío,
    # las rutas de avatar responden 503 y el resto del servicio funciona.
    minio_endpoint: str = ""
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_secure: bool = False
    minio_bucket: str = "geopicto-avatars"

    # Prefijo público de los avatares (la ruta del gateway); la avatarUrl que ve
    # el cliente es este prefijo más la clave del objeto.
    avatar_public_base_url: str = "http://localhost:8080/api/profiles/avatars"

    avatar_max_bytes: int = 5 * 1024 * 1024
    avatar_uploads_per_hour: int = 10

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def avatar_url_for(self, key: str) -> str:
        return f"{self.avatar_public_base_url.rstrip('/')}/{key}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
