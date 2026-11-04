# GeoPicto — Microservicio de Rating

Registra likes y dislikes sobre mensajes publicados, mantiene los conteos por mensaje y publica `rating.changed.v1` para que `reputation` actualice el puntaje del autor.

Go 1.27 · `net/http` · PostgreSQL (`pgx/v5`, `golang-migrate`) · RabbitMQ (`amqp091-go`) · `slog`.

## Estructura

```
cmd/api/               arranque: migraciones, BD, broker, rutas HTTP
cmd/simulate-message/  herramienta de prueba: publica message.published / message.deleted
db/migrations/         tablas message_ratings, message_rating_stats, message_projection
internal/domain/       reglas puras: valores, CheckRateable, ApplyVote
internal/service/      casos de uso; publica el evento despues del commit
internal/repository/   PostgreSQL: transaccion con SELECT ... FOR UPDATE sobre stats
internal/messaging/    conexion con reconexion, consumidor y publicador
internal/handler/      HTTP, mapeo de errores, rate limit por usuario
```

## API

Rutas internas que el API Gateway publica bajo `/api/ratings/**` con `JwtAuth`; el gateway agrega `X-User-ID` y el servicio confía en esa cabecera. Las respuestas exitosas devuelven el dato directo, sin `{ success, data }`.

| Método y ruta | Respuesta |
| --- | --- |
| `PUT /ratings/messages/{messageId}` | Body `{"value":"LIKE"}` o `{"value":"DISLIKE"}`. Resumen actualizado. |
| `DELETE /ratings/messages/{messageId}` | Quita el voto. Resumen actualizado. |
| `GET /ratings/messages/{messageId}` | Resumen con `myRating`. |
| `POST /ratings/messages/batch` | Body `{"messageIds":[...]}` (máx. 100). Array de resúmenes en el mismo orden, sin repetidos; los mensajes sin votos salen en cero. |
| `GET /health` | `{"status":"ok|degraded|down","database":"...","broker":"..."}`. 503 solo si la base de datos no responde. |

```json
{ "messageId": "550e8400-...", "likes": 12, "dislikes": 2, "score": 10, "myRating": "LIKE" }
```

Errores: `{ "error": "codigo", "message": "texto" }`.

| Código | HTTP | Cuándo |
| --- | --- | --- |
| `unauthorized` | 401 | Falta `X-User-ID` o no es UUID. |
| `invalid_message_id` | 400 | El id del mensaje no es UUID. |
| `invalid_request` / `batch_too_large` | 400 | Body de batch inválido o más de 100 ids. |
| `message_not_found` | 404 | `GET` de un mensaje que rating no conoce o que fue eliminado. |
| `self_rating_forbidden` | 403 | Votar el propio mensaje. |
| `message_not_ready` | 409 | El mensaje aún no llegó a la proyección (no hubo `message.published`). |
| `message_not_rateable` | 409 | El mensaje está bloqueado o eliminado. |
| `invalid_rating_value` | 422 | `value` distinto de `LIKE`/`DISLIKE`. |
| `rate_limited` | 429 | Más de 30 votos/min (PUT+DELETE) o 100 batch/min por usuario. Incluye `Retry-After`. |

## Reglas

- Un voto por usuario y mensaje (`UNIQUE (message_id, user_id)`).
- `PUT` con el mismo voto y `DELETE` sin voto no modifican nada ni emiten evento.
- El voto anterior se lee dentro de la transacción, con la fila de `message_rating_stats` bloqueada (`FOR UPDATE`), así los votos concurrentes al mismo mensaje no pierden conteos. `score = likes - dislikes`.
- `rating.changed.v1` se publica después del commit. Si RabbitMQ está caído el voto queda guardado y el evento se pierde (se registra en el log); en P2 no hay outbox.
- Si `message.deleted` llega antes que `message.published`, el mensaje queda `DELETED` y la publicación tardía no lo revierte.
- El rate limit es en memoria: vale para una sola instancia.

## Eventos

Exchange `topic` `geopicto.events`.

| Cola | Routing key | Efecto |
| --- | --- | --- |
| `rating.message.published.q` | `message.published.v1` | Inserta/actualiza la proyección (`authorId`, `PUBLISHED`). |
| `rating.message.deleted.q` | `message.deleted.v1` | Marca `DELETED`. `payload.authorId` es opcional. |

Ambos consumidores son idempotentes por `messageId`. Un evento mal formado se descarta (`nack` sin reencolar); un error de base de datos se reencola.

**Publica** `rating.changed.v1` con `previousValue`/`value` en `-1`, `0` (sin voto) o `1`, el `messageAuthorId` tomado de la proyección y los conteos tras el cambio. `correlationId` sale del header `X-Correlation-ID` si llega y es un UUID (reputation lo decodifica como UUID); si no, es el `eventId`.

## Variables de entorno

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `DATABASE_URL` | — (obligatoria) | PostgreSQL. Las migraciones se aplican al arrancar. |
| `PORT` | `8080` | Puerto HTTP. |
| `RABBITMQ_URL` | `amqp://geopicto:geopicto@rabbitmq:5672/geopicto` | Broker. Si no está disponible el servicio arranca igual y reintenta. |
| `RABBITMQ_EXCHANGE` | `geopicto.events` | Exchange topic. |
| `RATE_LIMIT_VOTES_PER_MINUTE` | `30` | Votos (PUT+DELETE) por usuario y minuto. |
| `RATE_LIMIT_BATCH_PER_MINUTE` | `100` | Consultas batch por usuario y minuto. |

## Ejecutar aislado

```bash
cd services/rating
docker compose up --build
```

Servicio en `http://localhost:8102`, PostgreSQL en `5437` y RabbitMQ en `5673` (consola en `http://localhost:15673`, usuario/clave `geopicto`). Sin gateway, las peticiones llevan `X-User-ID` a mano.

El servicio de mensajes todavía no publica `message.published.v1`, así que para tener un mensaje votable hay que simularlo:

```bash
AUTHOR=11111111-1111-1111-1111-111111111111
VOTER=22222222-2222-2222-2222-222222222222
MSG=33333333-3333-3333-3333-333333333333

docker compose exec rating simulate-message -message $MSG -author $AUTHOR

curl -X PUT localhost:8102/ratings/messages/$MSG -H "X-User-ID: $VOTER" -H "Content-Type: application/json" -d '{"value":"LIKE"}'
curl localhost:8102/ratings/messages/$MSG -H "X-User-ID: $VOTER"
curl -X POST localhost:8102/ratings/messages/batch -H "X-User-ID: $VOTER" -H "Content-Type: application/json" -d "{\"messageIds\":[\"$MSG\"]}"

docker compose exec rating simulate-message -message $MSG -deleted   # desde aqui, 409 message_not_rateable
```

## Pruebas

```bash
go test ./...
```

Las pruebas de `internal/repository` (concurrencia, idempotencia, batch en una sola consulta) usan PostgreSQL real y se saltan si no se define `RATING_TEST_DATABASE_URL`:

```bash
docker compose up -d rating-db
RATING_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5437/rating?sslmode=disable go test ./...
```
