# Rating — Requisitos Prototipo 2

> Componente pendiente. Gestiona likes y dislikes de mensajes y publica el evento que alimenta la reputación.

## 1. Propósito

Registrar votos (like/dislike) sobre mensajes publicados, mantener conteos consistentes y emitir `rating.changed.v1` al broker para que `reputation` actualice el puntaje del autor.

## 2. Alcance

**Incluye**

- [ ] Like, dislike y eliminación del voto.
- [ ] Un voto por usuario por mensaje.
- [ ] Conteos agregados por mensaje.
- [ ] Consulta individual y batch.
- [ ] Proyección local `messageId -> authorId` a partir de eventos.
- [ ] Publicación de `rating.changed.v1`.

**No incluye**

- Comentarios, reacciones múltiples ni estrellas.
- Edición de mensajes.
- Cálculo de reputación.

## 3. Reglas de negocio

- [ ] Solo se vota un mensaje en estado `PUBLISHED` (incluye `WARN`).
- [ ] No se puede votar el propio mensaje: `403 self_rating_forbidden`.
- [ ] `PUT` es idempotente: mismo voto no cambia nada ni emite evento.
- [ ] Cambio like→dislike: delta `-2`; dislike→like: `+2`.
- [ ] `DELETE` quita el voto y emite `value: 0`.
- [ ] Si el mensaje no está en la proyección: `409 message_not_ready`.
- [ ] Si el mensaje está bloqueado/eliminado: `409 message_not_rateable`.
- [ ] Voto, conteos y evento se confirman en la misma operación lógica. Para P2 el evento se publica después del commit, sin outbox.

## 4. API HTTP

Rutas internas; el gateway las publica bajo `/api/ratings`. **Las respuestas exitosas devuelven directamente el dato, sin `{ success, data }`.**

| Método y ruta | Autenticación | Respuesta |
| --- | --- | --- |
| `PUT /ratings/messages/{messageId}` | JWT | Resumen del rating. Body `{ "value": "LIKE" }` o `{ "value": "DISLIKE" }`. |
| `DELETE /ratings/messages/{messageId}` | JWT | Resumen actualizado. |
| `GET /ratings/messages/{messageId}` | JWT | Resumen + `myRating`. |
| `POST /ratings/messages/batch` | JWT | Array de resúmenes. Body `{ "messageIds": ["..."] }`, máximo 100. |
| `GET /health` | — | Estado del servicio, BD y broker. |

Respuesta individual:

```json
{
  "messageId": "550e8400-e29b-41d4-a716-446655440000",
  "likes": 12,
  "dislikes": 2,
  "score": 10,
  "myRating": "LIKE"
}
```

`myRating` es `"LIKE"`, `"DISLIKE"` o `null`.

Errores: `{ "error": "codigo", "message": "texto" }`. Códigos: `message_not_found` (404), `message_not_ready` (409), `message_not_rateable` (409), `self_rating_forbidden` (403), `invalid_rating_value` (422), `rate_limited` (429).

## 5. Modelo de datos (PostgreSQL `rating`)

Solo tablas de lógica de negocio. **Sin tablas de outbox ni de eventos procesados.**

```sql
CREATE TABLE message_ratings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL,
  user_id    UUID NOT NULL,
  value      SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

CREATE TABLE message_rating_stats (
  message_id UUID PRIMARY KEY,
  author_id  UUID NOT NULL,
  likes      INTEGER NOT NULL DEFAULT 0,
  dislikes   INTEGER NOT NULL DEFAULT 0,
  score      INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE message_projection (
  message_id   UUID PRIMARY KEY,
  author_id    UUID NOT NULL,
  status       VARCHAR(16) NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_message_ratings_message ON message_ratings (message_id);
CREATE INDEX idx_message_ratings_user ON message_ratings (user_id);
CREATE INDEX idx_rating_stats_score ON message_rating_stats (score DESC);
```

- [ ] La restricción única `(message_id, user_id)` es la idempotencia del voto.
- [ ] `score = likes - dislikes`.
- [ ] Usar transacción y `SELECT ... FOR UPDATE` sobre stats para votos concurrentes al mismo mensaje.

## 6. Eventos

**Consume**

- `rating.message.published.q` ← `message.published.v1`: inserta/actualiza `message_projection` con `authorId` y estado.
- `rating.message.deleted.q` ← `message.deleted.v1`: marca `status = DELETED`.
- Opcional `rating.user.deleted.q` ← `user.deleted.v1`.

**Publica**

- `rating.changed.v1` en cada cambio real de voto.

```json
{
  "eventId": "0192f3a4-...",
  "eventType": "rating.changed.v1",
  "version": 1,
  "occurredAt": "2026-10-24T14:30:00Z",
  "producer": "rating",
  "correlationId": "b3b1c2d4-...",
  "causationId": "a1a1a1a1-...",
  "payload": {
    "ratingId": "8a7b...",
    "messageId": "550e8400-...",
    "messageAuthorId": "7b8339ec-...",
    "raterId": "9c8d...",
    "previousValue": 1,
    "value": -1,
    "likes": 11,
    "dislikes": 3,
    "changedAt": "2026-10-24T14:30:00Z"
  }
}
```

- [ ] El evento se publica después del commit. Si RabbitMQ falla, se registra el error y el voto queda persistido; para P2 no se implementa outbox.
- [ ] Un evento duplicado no debe duplicar puntos en `reputation` (se resuelve allí con `eventId`).

## 7. Requisitos no funcionales

- [ ] p95 < 120 ms para votar y < 80 ms para consultar.
- [ ] Soportar 500 votos/s en local.
- [ ] Rate limit: 30 votos/minuto por usuario; 100 batch/minuto.
- [ ] Batch en una sola query (`WHERE message_id = ANY($1)`).
- [ ] No votar mensajes inexistentes o no publicados.

## 8. Consejo técnico

**Recomendado:** Go 1.24 + `chi` + `pgx/v5` + `goose` + `amqp091-go` + `slog` (+ `sqlc` opcional).

- Mismo lenguaje que `messages`; se reutiliza el patrón de repositorio, migraciones y Dockerfile.
- Go maneja bien la concurrencia de votos y el consumidor de eventos.
- `sqlc` reduce errores de SQL; si el equipo no lo conoce, `pgx` directo.

**Alternativa para el quinto lenguaje:** Rust + Axum + SQLx + `lapin`. Si el socket gateway no se hace en Elixir, Rust aquí es una buena opción para llegar a 5 lenguajes. No lo elijas solo por cumplir: la curva de aprendizaje puede costar más que el beneficio.

**Trampas**

- No calcular el delta desde el body; leer el voto anterior en la transacción.
- No permitir votos propios; el `authorId` viene de `message.published`.
- Si `message.deleted` llega antes de `message.published`, la proyección debe quedar `DELETED` y no revertirse.

## 9. Tareas

- [ ] Crear `services/rating` con capas `handler`, `service`, `repository`, `domain`, `schema`, `consumer`.
- [ ] Migraciones de las tres tablas.
- [ ] Implementar `PUT`, `DELETE`, `GET` y `POST /batch`.
- [ ] Consumidor de `message.published`/`message.deleted` idempotente por clave natural.
- [ ] Publicación de `rating.changed` tras el commit.
- [ ] Tests de concurrencia, idempotencia y like→dislike.
- [ ] `README.md`, `.env.example`, `Dockerfile`, `docker-compose.yml`.
- [ ] Ruta `/api/ratings/**` en el gateway con `JwtAuth`.

## 10. Definition of Done

- [ ] Like, cambio a dislike y eliminación cuadran los conteos.
- [ ] El mismo `PUT` repetido no duplica conteos ni eventos.
- [ ] No se puede votar el propio mensaje.
- [ ] `rating.changed` sale con el `messageAuthorId` correcto.
- [ ] El batch de 100 mensajes responde en una sola llamada.
- [ ] El servicio sigue respondiendo si RabbitMQ está caído (el voto se guarda; el evento se pierde en P2 y se registra).
