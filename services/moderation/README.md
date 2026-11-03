# Servicio de moderación

## Propósito

Decide si un mensaje nuevo se publica (`ALLOW`), se publica con advertencia (`WARN`) o se bloquea (`BLOCK`). Escucha los mensajes que crea `messages`, los evalúa con **reglas determinísticas** y con la **API de moderación de OpenAI**, guarda la decisión para auditoría y responde por el broker. Está escrito en **Python (FastAPI)** y guarda las decisiones en **PostgreSQL**.

No borra ni edita mensajes (eso lo hace `messages`) y no notifica a nadie (eso lo hace `socket-gateway`). El diseño completo y las tareas pendientes están en [README_P2.md](README_P2.md).

El código usa las mismas capas que `profile`:

- `app/main.py`: crea la aplicación, carga las reglas y el clasificador, arranca el consumidor y expone `/health`.
- `app/handler`: rutas internas (`/internal/*`).
- `app/service`: normalización del texto (`normalize.py`), reglas (`rules.py`), clasificador de OpenAI (`classifier.py`) y la decisión final (`moderation_service.py`).
- `app/repository`: consultas a la tabla `moderation_decisions`.
- `app/domain`: modelo `ModerationDecision` (SQLAlchemy).
- `app/schema`: contratos de entrada y salida de la API (Pydantic, en camelCase).
- `app/messaging`: conexión a RabbitMQ, consumidor de `message.submitted.v1` / `message.edited.v1` y publicación de `moderation.completed.v1` / `moderation.failed.v1`.
- `rules/moderation.yaml`: reglas versionadas.
- `migrations`: esquema versionado con Alembic.
- `tests`: pruebas de reglas, decisiones, idempotencia, reintentos y API (pytest).

## Flujo

1. `messages` guarda el mensaje como `PENDING` y publica `message.submitted.v1`.
2. `moderation` lo consume de `moderation.message.submitted.q`, decide, guarda la decisión y publica `moderation.completed.v1`.
3. `messages` aplica la decisión: `ALLOW` y `WARN` se publican, `BLOCK` no.

Si `moderation` no responde dentro de `MODERATION_TIMEOUT_SECONDS` (5 s en el `docker-compose.yml` raíz), `messages` aplica su política `FAIL_OPEN` / `FAIL_CLOSED`.

## Cómo se decide

1. **Normalización:** minúsculas, Unicode NFKC, sin tildes ni caracteres de ancho cero, espacios colapsados y leetspeak básico traducido (`p3rr0` → `perro`). Se analizan como máximo 2000 caracteres.
2. **Reglas duras** (`rules/moderation.yaml`):
   - `BLOCK`: amenazas (`THREAT`) y datos personales (`DOXXING`: celulares, correos y direcciones).
   - `WARN`: más de 2 enlaces (`SPAM_LINKS`), repetición (`REPEATED_CONTENT`) o mayúsculas sostenidas (`EXCESSIVE_CAPS`).
3. **Clasificador** (`omni-moderation-latest` de OpenAI):
   - `BLOCK` si una categoría grave (amenazas, violencia, contenido sexual con menores, instrucciones de autolesión, delitos violentos) supera `BLOCK_THRESHOLD` (0.80).
   - `WARN` si cualquier categoría supera `WARN_THRESHOLD` (0.60).
4. **Combinación:** una regla `BLOCK` gana siempre; luego un `BLOCK` del modelo; luego cualquier `WARN`; si no, `ALLOW`.
5. **Historial del autor (24 h):** con 3 `WARN` previos, el siguiente mensaje se bloquea; con 1 `BLOCK` previo, un `WARN` se convierte en `BLOCK`. Se marca con la razón `AUTHOR_ESCALATION`.

Si no hay `OPENAI_API_KEY`, o la API falla o tarda más de `OPENAI_TIMEOUT_SECONDS`, se decide **solo con reglas** y la decisión queda con `degraded = true` y la razón `MODEL_UNAVAILABLE`. El servicio nunca se cae por el clasificador.

> **Privacidad:** con `OPENAI_API_KEY`, el contenido de cada mensaje se envía a OpenAI. Los logs del servicio nunca incluyen el contenido; solo `messageId`, `authorId`, la decisión, la confianza y las razones.

## API

No pasa por el gateway. Las rutas `/internal/*` exigen el encabezado `X-Internal-Token` (`INTERNAL_TOKEN`).

| Método y ruta | Autenticación | Respuesta |
| --- | --- | --- |
| `POST /internal/moderate` | `X-Internal-Token` | Decisión directa. Cuerpo `{ messageId, authorId, content, messageVersion? }`. **No guarda ni publica**: es para pruebas. |
| `GET /internal/decisions/{messageId}` | `X-Internal-Token` | Última decisión del mensaje, o `404`. |
| `GET /health` | — | Estado de la BD, el broker y el clasificador. `503` si la BD falla. |

```json
{
  "messageId": "550e8400-e29b-41d4-a716-446655440000",
  "messageVersion": 1,
  "decision": "WARN",
  "confidence": 0.71,
  "reasons": ["MODEL_WARN", "CATEGORY_HARASSMENT"],
  "modelVersion": "omni-moderation-2024-09-26",
  "ruleVersion": "2026-11-02.1",
  "degraded": false,
  "latencyMs": 180,
  "decidedAt": "2026-11-02T14:31:00Z"
}
```

Errores: `{ "error": "codigo", "message": "texto" }`.

## Eventos

| Dirección | Evento | Cola |
| --- | --- | --- |
| Consume | `message.submitted.v1` | `moderation.message.submitted.q` |
| Consume | `message.edited.v1` (`messages` aún no lo publica) | `moderation.message.edited.q` |
| Publica | `moderation.completed.v1` | — |
| Publica | `moderation.failed.v1` | — |

- **Idempotencia:** la tabla tiene una restricción única en `(message_id, message_version)`. Si llega otra vez el mismo evento, se vuelve a publicar la decisión guardada sin reevaluar.
- **Reintentos:** ante un error (por ejemplo, la BD caída) se reintenta 3 veces con backoff exponencial. Después se publica `moderation.failed.v1` y el evento va a la cola `moderation.dlq`, desde donde se puede republicar a mano en la consola de RabbitMQ.

## Ejecutar

Con el sistema completo, desde la raíz del repositorio:

```bash
docker compose up --build
```

Para usar el clasificador, define `OPENAI_API_KEY` en el `.env` de la raíz.

De forma aislada (API en `http://localhost:8400`):

```bash
cp .example.env .env
docker compose up --build
```

Pruebas:

```bash
uv sync --group dev
uv run pytest
```

## Pendiente

- Lista local de términos `PROFANITY_HIGH`: está vacía a propósito; sin OpenAI, los insultos no se detectan.
- Retención de 90 días de las decisiones.
- `GET /moderation/decisions` (auditoría con roles).
- Que `messages` publique `message.edited.v1`.
