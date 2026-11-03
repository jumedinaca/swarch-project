# Servicio de Email

## Propósito

Este microservicio envía en segundo plano los correos transaccionales de GeoPicto (bienvenida al registrarse y correos genéricos solicitados por otros componentes) a partir de eventos de RabbitMQ. Está escrito en **Python 3.13 (FastAPI)**, persiste el registro de envíos en **PostgreSQL**, renderiza plantillas con **Jinja2** y entrega mediante **SMTP asíncrono (`aiosmtplib`)** contra **Mailpit** en local o un proveedor con TLS en producción.

El envío **nunca** ocurre dentro de la petición HTTP de otro servicio: todo correo se encola y se procesa de forma asíncrona.

### Estructura del código

- `app/main.py`: crea la aplicación FastAPI, levanta el consumidor de RabbitMQ, el worker local de respaldo y la tarea de retención, y expone `/health`.
- `app/handler`: rutas internas (`POST /internal/emails`, `GET /internal/emails/{id}`) y manejo uniforme de errores `{ "error", "message" }`.
- `app/service`: orquestación de envíos (`email_service.py`), motor de plantillas con autoescape (`template_renderer.py`) y cliente SMTP (`smtp_client.py`).
- `app/messaging`: conexión robusta a RabbitMQ, contratos de eventos, consumidor y topología de reintentos con TTL + DLQ.
- `app/repository`: operaciones idempotentes y consultas sobre `email_log`.
- `app/domain`: modelo SQLAlchemy `EmailLog`.
- `app/schema`: validadores Pydantic de plantillas, enlaces `http`/`https` y direcciones de correo.
- `app/core`: configuración, enmascaramiento de privacidad con `structlog`, autenticación `X-Internal-Token` y límites de tasa.
- `app/templates`: plantillas registradas (`welcome` y `generic`) en HTML responsive + texto plano obligatorio.
- `migrations`: migración Alembic de `email_log`.

## API Interna

Este servicio **no se expone en el API Gateway**. Las respuestas exitosas devuelven el dato directo, sin sobre `{ success, data }`.

| Método y ruta | Autenticación | Respuesta |
| --- | --- | --- |
| `POST /internal/emails` | `X-Internal-Token` | `202` con `{ "emailId": "...", "status": "QUEUED" }`. |
| `GET /internal/emails/{id}` | `X-Internal-Token` | `200` con el estado del envío (destinatario enmascarado `j***@dominio.com`). |
| `GET /health` | — | Estado de la base de datos, del servidor SMTP (`NOOP`, sin enviar correo) y del broker. |

## Plantillas Registradas

Solo se aceptan plantillas registradas (no se admite HTML arbitrario del productor):

| Plantilla | Variables | Uso |
| --- | --- | --- |
| `welcome` | `username` | Correo de bienvenida al consumir `user.registered.v1`. |
| `generic` | `title`, `body`, `ctaUrl?`, `ctaLabel?` | Notificaciones transaccionales generales (`ctaUrl` exige enlace absoluto `http`/`https`). |

Todas las variables pasan por autoescape en HTML, el ancho máximo es `600 px` con CSS inline, incluyen pie `"GeoPicto"` sin enlace de baja y adjuntan siempre versión `text/plain` junto a `text/html` (`multipart/alternative`).

## Eventos y Reintentos

- **Consume** desde `geopicto.events` (`topic`):
  - `email.user.registered.q` ← `user.registered.v1`: envía `welcome` con `idempotencyKey = welcome:<userId>`.
  - `email.send.q` ← `email.requested.v1`: envía la plantilla solicitada (si no incluye `idempotencyKey`, usa `emailId`).
- **Publica** (controlado por `PUBLISH_STATUS_EVENTS=true`):
  - `email.sent.v1` y `email.failed.v1`.
- **Reintentos y DLQ sin bloqueo**:
  - Fallos transitorios de SMTP se reencolan en colas de espera por TTL (`10 s`, `1 min`, `5 min`) a través de `geopicto.email.dlx` → `geopicto.email.retry`. Tras agotar los 3 reintentos, el registro pasa a `status = 'DLQ'` y el mensaje cae en `email.dlq`.
  - Correos inválidos, plantillas inexistentes o rechazos permanentes `5xx` fallan de inmediato sin reintentos infinitos.
- **Límites y privacidad**:
  - `5` correos/hora por destinatario (`RATE_LIMIT_PER_RECIPIENT_PER_HOUR`) y `100` correos/minuto globales (`GLOBAL_RATE_LIMIT_PER_MINUTE`).
  - Ningún log ni columna `last_error` almacena direcciones completas ni cuerpos de correo (`j***@dominio.com`).

## Ejecución Aislada con Docker Compose

```powershell
Copy-Item .env.example .env
docker compose up --build
```

- API interna: `http://localhost:8400`
- Bandeja web de Mailpit: `http://localhost:8025`
- Consola de RabbitMQ: `http://localhost:15672` (`geopicto` / `geopicto`)

Probar un envío manual:

```bash
curl -X POST http://localhost:8400/internal/emails \
  -H "X-Internal-Token: dev-internal-token" \
  -H "Content-Type: application/json" \
  -d '{"to":"explorador@geochat.org","template":"generic","subject":"Novedades en GeoPicto","variables":{"title":"Hola","body":"Hay actividad nueva cerca de ti.","ctaUrl":"http://localhost:8081","ctaLabel":"Abrir mapa"}}'
```

## Envío Real por Internet desde Local (Gmail / SMTP Externo)

Sin configuración extra, el servicio entrega en **Mailpit** (`mailpit:1025`). Si deseas que desde tu entorno local envíe correos reales a bandejas de internet (Gmail, Outlook, etc.), define un relay SMTP autenticado en `.env` (en la raíz para el sistema completo o en `services/email/.env` para ejecución aislada), por ejemplo con una **Contraseña de aplicación** de Gmail:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=tu.correo@gmail.com
SMTP_PASSWORD=xxxx xxxx xxxx xxxx
SMTP_USE_TLS=false
SMTP_STARTTLS=true
SMTP_FROM=GeoPicto <tu.correo@gmail.com>
DEFAULT_REPLY_TO=tu.correo@gmail.com
```

Luego recrea el contenedor con `docker compose up -d --build email`.

## Pruebas

```powershell
uv sync --group dev
uv run pytest
```

Las pruebas levantan SQLite en memoria/archivo temporal y un servidor SMTP real local con `aiosmtpd`, por lo que no requieren Docker.
