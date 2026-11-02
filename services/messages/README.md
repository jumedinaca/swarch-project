# Servicio de mensajes

## Propósito y estado

Este componente proporciona la API para publicar mensajes asociados a coordenadas, consultar los que se encuentran dentro de un radio geográfico y gestionar su ciclo de vida con moderación. Está escrito en Go y persiste los mensajes en PostgreSQL con PostGIS.

El código se organiza en estas capas:

- `cmd/api`: carga de configuración, migraciones, dependencias, consumidor y rutas HTTP.
- `internal/handler`: manejo de solicitudes y respuestas HTTP.
- `internal/service`: reglas de negocio, moderación y barrido de pendientes.
- `internal/repository`: operaciones de persistencia y consultas espaciales.
- `internal/messaging`: conexión a RabbitMQ, publicación y consumo de eventos.
- `internal/middleware`: verificación del JWT.
- `internal/domain`, `internal/schema`: entidad de dominio y contratos de eventos/solicitudes.
- `db/migrations`: esquema de base de datos versionado.

La tabla `messages` guarda el UUID del mensaje, el UUID del emisor, el contenido, una ubicación `GEOGRAPHY(Point, 4326)`, el estado (`PENDING`, `PUBLISHED`, `BLOCKED`, `DELETED`), el estado de moderación, la versión del mensaje y las fechas de creación/actualización. `GET /messages/nearby` solo devuelve mensajes `PUBLISHED`.

## Ejecución con Docker Compose

Desde este directorio, crea `.env` usando `.example.env` y arranca la API, PostgreSQL/PostGIS y RabbitMQ:

```bash
cp .example.env .env
docker compose up --build
```

La API queda publicada en `http://localhost:8100`. El contenedor ejecuta las migraciones pendientes al iniciar. RabbitMQ queda en `localhost:5672` (consola en `http://localhost:15672`, usuario/clave `geopicto`).

| Variable | Obligatoria | Valor por defecto | Descripción |
| --- | --- | --- | --- |
| `DATABASE_URL` | Sí | Sin valor | Cadena de conexión PostgreSQL. El ejemplo usa el servicio `messages-db`. |
| `PORT` | No | `8080` | Puerto HTTP dentro del contenedor. |
| `JWT_SECRET` | Sí | Sin valor | Secreto HS256 compartido con `auth` y el gateway (mínimo 32 bytes). |
| `JWT_ISSUER` | No | `geopicto-auth` | Emisor exigido en el claim `iss`. |
| `JWT_LEEWAY_SECONDS` | No | `10` | Tolerancia de reloj al validar `exp`/`iat`. |
| `RABBITMQ_URL` | No | Vacío | Si está vacío, se deshabilitan la publicación y el consumidor de moderación. |
| `RABBITMQ_EXCHANGE` | No | `geopicto.events` | Exchange topic de eventos. |
| `MODERATION_TIMEOUT_SECONDS` | No | `10` | Tiempo máximo de espera antes de aplicar la política de fallo. |
| `PENDING_SWEEP_INTERVAL_SECONDS` | No | `5` | Cada cuánto se buscan mensajes `PENDING` vencidos. |
| `FAIL_OPEN` | No | `true` | Si moderación falla, publica con `moderation_status=DEGRADED`. |
| `FAIL_CLOSED` | No | `false` | Si moderación falla, bloquea el mensaje. Tiene prioridad sobre `FAIL_OPEN`. |

## Autenticación

Las rutas protegidas exigen `Authorization: Bearer <token>`. El servicio valida el JWT por su cuenta (firma HS256, `iss`, `exp` y `sub` UUID), aunque la petición venga del API Gateway. `GET /messages/nearby` y `GET /health` son públicas.

## API HTTP

Las respuestas exitosas devuelven el objeto o el array directamente, sin sobre `{ success, data }`.

| Método y ruta | Descripción | Entrada |
| --- | --- | --- |
| `POST /messages` | Crea un mensaje en `PENDING` y publica `message.submitted.v1`. Responde `201`. | `Authorization: Bearer`; JSON con `content`, `latitude` y `longitude`. |
| `GET /messages/{id}` | Consulta un mensaje por UUID, únicamente si pertenece al usuario autenticado. Devuelve cualquier estado. | `Authorization: Bearer`. |
| `DELETE /messages/{id}` | Marca el mensaje como `DELETED` y publica `message.deleted.v1`. Responde `200` sin cuerpo. | `Authorization: Bearer`. |
| `GET /messages/nearby?lat=&lng=&radius=` | Devuelve solo mensajes `PUBLISHED` dentro del radio, ordenados por distancia. | Parámetros `lat`, `lng` y `radius` (metros). Pública. |
| `GET /health` | Estado de la base de datos y del broker. | — |

Ejemplo para crear un mensaje:

```http
POST /messages
Authorization: Bearer <token>
Content-Type: application/json

{
  "content": "Mensaje de ejemplo",
  "latitude": 40.4168,
  "longitude": -3.7038
}
```

La respuesta contiene `id`, `sender_id`, `content`, `location`, `created_at`, `status`, `moderation_status`, `version` y `updated_at`:

```json
{
  "id": "550e8400-...",
  "sender_id": "7b8339ec-...",
  "content": "Hola desde la Plaza Che",
  "location": { "latitude": 4.6371, "longitude": -74.0834 },
  "created_at": "2026-10-24T14:30:00Z",
  "status": "PENDING",
  "moderation_status": "PENDING",
  "version": 1,
  "updated_at": "2026-10-24T14:30:00Z"
}
```

El servicio no devuelve `authorColor`: el frontend resuelve el perfil y el color con `GET /api/profiles/batch`.

### Validaciones y consideraciones

- La creación rechaza contenido vacío o solo espacios.
- La búsqueda cercana exige los tres parámetros como números y comprueba que la latitud esté entre `-90` y `90`, la longitud entre `-180` y `180`, y que el radio sea mayor que cero.
- Los errores se responden como texto plano. Los UUID inválidos del mensaje generan `400`; la falta de un JWT válido genera `401`.
- En el entorno completo este servicio no se publica al host: se accede a través del API Gateway (`/api/messages/...`), que valida el JWT, conserva `Authorization` y añade `X-User-ID`.

## Moderación y eventos

Flujo:

1. `POST /messages` inserta el mensaje con `status=PENDING` y `moderation_status=PENDING`.
2. Después del commit publica `message.submitted.v1`.
3. Consume `moderation.completed.v1` y `moderation.failed.v1`.
4. Aplica la decisión solo si `id` y `version` coinciden y el mensaje sigue `PENDING` (idempotencia).
5. Publica `message.published.v1` cuando el mensaje queda visible (`ALLOW`, `WARN` o `DEGRADED`).

Decisiones:

| `decision` | `status` | `moderation_status` | Publica |
| --- | --- | --- | --- |
| `ALLOW` | `PUBLISHED` | `ALLOW` | `message.published.v1` |
| `WARN` | `PUBLISHED` | `WARN` | `message.published.v1` |
| `BLOCK` | `BLOCKED` | `BLOCK` | No |
| `REVIEW` | `PENDING` | `PENDING` | No |

Colas consumidas: `messages.moderation.completed.q` ← `moderation.completed.v1` y `messages.moderation.failed.q` ← `moderation.failed.v1`.

Si moderación no responde en `MODERATION_TIMEOUT_SECONDS` o llega `moderation.failed.v1`, se aplica `FAIL_OPEN` o `FAIL_CLOSED`. Un job interno busca mensajes `PENDING` vencidos usando la propia tabla `messages`; no hay outbox ni tabla de eventos procesados. Si RabbitMQ está caído, crear un mensaje no falla: queda `PENDING` y el error se registra.

## Alcance documentado

Este README describe exclusivamente el componente `messages` y el comportamiento observable en su código. El objetivo funcional compartido para el proyecto es publicar mensajes con ubicación, permitir su consulta por proximidad y publicarlos solo después de la moderación.
