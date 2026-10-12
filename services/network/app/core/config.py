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
    APP_ENV: str = 'development'
    # UUID usado como usuario cuando no llega X-User-ID (solo en desarrollo)
    DEV_USER_ID: str = "00000000-0000-0000-0000-000000000001"
    
    # --- Database ---
    MONGO_HOST: str = ""
    MONGO_DB: str = ""
    MONGO_ROOT_USERNAME: str=""
    MONGO_ROOT_PASSWORD: str=""

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
    return get_settings().APP_ENV == 'development'