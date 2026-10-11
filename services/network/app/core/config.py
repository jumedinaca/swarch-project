"""
Application configuration.

Settings are loaded from environment variables (and an optional .env file).
See .env.example for all supported values.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # --- General ---
    APP_NAME: str = "network"
    PORT: int = 8000
    DEV: bool = False

    # --- Database ---
    MONGO_HOST: str = ""
    MONGO_DB: str = ""

    # --- Security / JWT ---
    PUBLIC_KEY: str = ""
    ALGORITHM: str = ""
    # --- CORS ---
    CORS_ORIGINS: str = "*"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
