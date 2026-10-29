FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_NO_CACHE=1

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

COPY pyproject.toml uv.lock ./
RUN uv sync --locked

COPY . .

RUN useradd --create-home --uid 1000 appuser
USER appuser

EXPOSE 8000

# Aplica las migraciones pendientes y arranca la API
CMD ["sh", "-c", "uv run alembic upgrade head && uv run uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
