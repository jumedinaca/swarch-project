from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_RULES_PATH = Path(__file__).resolve().parents[2] / "rules" / "moderation.yaml"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    port: int = 8000

    # Si está vacío, no se consumen eventos; solo queda la API interna.
    rabbitmq_url: str = ""
    rabbitmq_exchange: str = "geopicto.events"

    # Protege las rutas /internal/*. Mismo esquema que socket-gateway.
    internal_token: str = Field(default="dev-internal-token", min_length=8)

    # Clasificador externo. Sin OPENAI_API_KEY el servicio decide solo con
    # reglas y marca cada decisión con degraded = true.
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "omni-moderation-latest"
    # Timeout duro de inferencia (README_P2 §7): si se supera, se usan las reglas.
    openai_timeout_seconds: float = 1.5

    block_threshold: float = 0.80
    warn_threshold: float = 0.60

    rules_path: Path = DEFAULT_RULES_PATH

    # Contenido máximo que se analiza (README_P2 §7).
    max_content_chars: int = 2000

    # Reintentos ante errores transitorios (BD caída) antes de moderation.failed.v1.
    max_attempts: int = 3
    retry_base_seconds: float = 0.5


@lru_cache
def get_settings() -> Settings:
    return Settings()
