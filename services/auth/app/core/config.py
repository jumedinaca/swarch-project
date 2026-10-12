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

    # Paleta de colores de avatar, igual a nintendoTheme.colors.avatarColors del frontend
    avatar_colors: str = "#2AC769,#1EA4E8,#F5A623,#E84393,#9B51E0"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def avatar_color_list(self) -> list[str]:
        return [c.strip() for c in self.avatar_colors.split(",") if c.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
