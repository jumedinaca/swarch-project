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
    DEV_USER_ID: str = "1"
    
    # --- Database ---
    MONGO_HOST: str = ""
    MONGO_DB: str = ""
    MONGO_ROOT_USERNAME: str=""
    MONGO_ROOT_PASSWORD: str=""

    # --- Security / JWT ---
    PUBLIC_KEY: str = ""
    ALGORITHM: str = ""
    # --- CORS ---
    CORS_ORIGINS: str = "*"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

setting = None

def get_settings():
    global setting

    if not setting: 
        setting = Settings()
    return setting

def isDev() -> bool:
    return get_settings().APP_ENV == 'development'