"""
Application configuration.

Settings are loaded from environment variables (and an optional .env file).
See .env.example for all supported values.
"""
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- General ---
    APP_NAME: str = "network"
    PORT: int = 8000
    APP_ENV: str = "development"

    # --- JWT ---
    # Debe coincidir con el secreto del servicio de auth y del API Gateway.
    JWT_SECRET: str = Field(min_length=32)
    JWT_ALGORITHM: str = "HS256"
    JWT_ISSUER: str = "geopicto-auth"
    JWT_LEEWAY_SECONDS: int = 10

    # --- Database ---
    MONGO_HOST: str = ""
    MONGO_DB: str = ""
    MONGO_ROOT_USERNAME: str = ""
    MONGO_ROOT_PASSWORD: str = ""

    # --- RabbitMQ ---
    # Si está vacío, los eventos de actividad quedan deshabilitados y el
    # servicio sigue funcionando igual.
    RABBITMQ_URL: str = ""
    RABBITMQ_EXCHANGE: str = "geopicto.events"

    # --- CORS ---
    # Vacío detrás del API Gateway: el gateway agrega las cabeceras CORS.
    CORS_ORIGINS: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


setting = None


def get_settings():
    global setting

    if not setting:
        setting = Settings()
    return setting


def isDev() -> bool:
    return get_settings().APP_ENV == "development"
