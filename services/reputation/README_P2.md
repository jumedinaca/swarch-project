# Reputation — Requisitos Prototipo 2

> Componente pendiente. Mantiene el puntaje y el nivel de reputación de cada usuario a partir de ratings y decisiones de moderación.

## 1. Propósito

Calcular y exponer la reputación de los usuarios, llevar un historial de movimientos y emitir `reputation.changed.v1` cuando el puntaje o el nivel cambian.

## 2. Alcance

**Incluye**

- [ ] Puntaje 0–1000 por usuario.
- [ ] Niveles derivados del puntaje.
- [ ] Ledger de movimientos (tabla de negocio, no de procesamiento de eventos).
- [ ] Consumo de `rating.changed.v1` y `moderation.completed.v1`.
- [ ] Consulta individual, `me`, leaderboard e historial.
- [ ] Publicación de `reputation.changed.v1`.

**No incluye**

- Cálculo de ratings.
- Moderación.
- Badges/logros.

## 3. Reglas de negocio

| Acción | Delta |
| --- | --- |
| Like recibido | `+2` |
| Dislike recibido | `-2` |
| Mensaje aprobado (`ALLOW`) | `+1` una vez por mensaje |
| Mensaje con advertencia (`WARN`) | `-3` una vez por mensaje |
| Mensaje bloqueado (`BLOCK`) | `-10` una vez por mensaje |
| `REVIEW` o `DEGRADED` | `0` |

- [ ] Puntaje inicial `0`; rango `0..1000`.
- [ ] El autor no recibe puntos por votar su propio mensaje (rating ya lo impide).
- [ ] No se otorgan puntos por votar, solo por recibir votos.
- [ ] Delta por cambio de voto: `(value - previousValue) * 2`.
- [ ] Ignorar eventos donde `raterId == messageAuthorId`.
- [ ] Cap diario opcional: máximo `+30` por likes recibidos/día.
- [ ] Idempotencia: `source_event_id` único en el ledger y `dedupe_key` único por usuario/evento de negocio.
- [ ] Si un mensaje pasa de `WARN` a `BLOCK`, aplicar la diferencia según una regla documentada.

**Niveles**

| Puntaje | Nivel | `levelIndex` |
| --- | --- | --- |
| 0–49 | Novato | 0 |
| 50–149 | Miembro | 1 |
| 150–349 | Confiable | 2 |
| 350–699 | Experto | 3 |
| 700–1000 | Leyenda | 4 |

## 4. API HTTP

Rutas internas; el gateway las publica bajo `/api/reputation`. **Las respuestas exitosas devuelven directamente el dato, sin `{ success, data }`.**

| Método y ruta | Autenticación | Respuesta |
| --- | --- | --- |
| `GET /reputation/me` | JWT | Objeto reputación. |
| `GET /reputation/{userId}` | JWT | Objeto reputación. |
| `GET /reputation/leaderboard?limit=20&cursor=` | JWT | Array paginado. |
| `GET /reputation/{userId}/history?limit=20&cursor=` | JWT | Array de movimientos. |
| `GET /health` | — | Estado, BD y broker. |

```json
{
  "userId": "7b8339ec-2e38-47b3-9d3b-7643652f1fc7",
  "score": 120,
  "level": "Confiable",
  "levelIndex": 2,
  "nextLevelAt": 350,
  "progress": 0.4,
  "likesReceived": 60,
  "dislikesReceived": 5,
  "messagesBlocked": 1,
  "messagesWarned": 2,
  "updatedAt": "2026-10-24T14:30:00Z"
}
```

Errores: `{ "error": "codigo", "message": "texto" }`.

## 5. Modelo de datos (PostgreSQL `reputation`)

Solo tablas de lógica de negocio. **Sin outbox ni processed_events.** `reputation_ledger` es el historial de movimientos de reputación (tabla de negocio), no una tabla de procesamiento de eventos.

```sql
CREATE TABLE user_reputation (
  user_id           UUID PRIMARY KEY,
  score             INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 1000),
  level             VARCHAR(32) NOT NULL DEFAULT 'Novato',
  likes_received    INTEGER NOT NULL DEFAULT 0,
  dislikes_received INTEGER NOT NULL DEFAULT 0,
  messages_blocked  INTEGER NOT NULL DEFAULT 0,
  messages_warned   INTEGER NOT NULL DEFAULT 0,
  version           INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reputation_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  delta           INTEGER NOT NULL,
  applied_delta   INTEGER NOT NULL,
  reason          VARCHAR(32) NOT NULL,
  source_event_id UUID NOT NULL,
  dedupe_key      VARCHAR(160) NOT NULL,
  score_after     INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_event_id),
  UNIQUE (user_id, dedupe_key)
);

CREATE INDEX idx_reputation_ledger_user_created
  ON reputation_ledger (user_id, created_at DESC);
```

- [ ] `reason`: `LIKE_RECEIVED`, `DISLIKE_RECEIVED`, `MESSAGE_ALLOWED`, `MESSAGE_WARNED`, `MESSAGE_BLOCKED`, `ADMIN_ADJUSTMENT`.
- [ ] `applied_delta` refleja el clamp/cap.
- [ ] `GET` de usuario sin fila devuelve `score: 0`, `level: "Novato"` (no 404).

## 6. Eventos

**Consume**

- `reputation.rating.changed.q` ← `rating.changed.v1`.
- `reputation.moderation.completed.q` ← `moderation.completed.v1`.

**Publica**

- `reputation.changed.v1` en cada cambio aplicado.

```json
{
  "eventId": "0192f3a4-...",
  "eventType": "reputation.changed.v1",
  "version": 1,
  "occurredAt": "2026-10-24T14:31:05Z",
  "producer": "reputation",
  "correlationId": "b3b1c2d4-...",
  "causationId": "a1a1a1a1-...",
  "payload": {
    "userId": "7b8339ec-...",
    "previousScore": 48,
    "score": 50,
    "delta": 2,
    "previousLevel": "Novato",
    "level": "Miembro",
    "levelChanged": true,
    "reason": "LIKE_RECEIVED",
    "sourceEventId": "0192f3a4-...",
    "occurredAt": "2026-10-24T14:31:05Z"
  }
}
```

- [ ] Publicar después del commit. Sin outbox en P2; si RabbitMQ falla, se registra el error.
- [ ] El ledger es la fuente de verdad; el puntaje se puede reconstruir desde él.

## 7. Requisitos no funcionales

- [ ] p95 < 100 ms en consultas y < 200 ms por evento.
- [ ] Soportar 300 eventos/s en local.
- [ ] Consumidor idempotente y tolerante al desorden.
- [ ] Reconstrucción desde el ledger (`recompute`) sin downtime.
- [ ] No usar `UPDATE score = score + delta` sin ledger.
- [ ] Si se clampea, registrar `applied_delta` distinto de `delta`.

## 8. Consejo técnico

**Recomendado:** Go 1.24 + `pgx/v5` + `goose` + `amqp091-go` + `slog`.

- Consumidor simple y eficiente; mismo patrón que `messages`/`rating`.
- `pgx` facilita transacciones: insertar ledger, verificar unique, actualizar `user_reputation`.
- `SELECT ... FOR UPDATE` sobre `user_reputation` para serializar cambios del mismo usuario.

**Alternativa para el quinto lenguaje:** Rust + Axum + SQLx + `lapin`. Si el socket gateway no se hace en Elixir, Rust aquí cubre el requisito. Si el socket sí es Elixir, no es necesario.

**Trampas**

- No confiar en el orden de eventos.
- No sumar eventos duplicados; la restricción única debe hacer fallar el insert y el consumidor debe hacer ack.
- No olvidar el clamp 0..1000.
- Centralizar `levelFor(score)`.
- No publicar antes del commit: publicar después de que el cambio esté persistido.

## 9. Tareas

- [ ] Crear `services/reputation` con capas `handler`, `service`, `repository`, `consumer`.
- [ ] Migraciones de `user_reputation` y `reputation_ledger`.
- [ ] Función de nivel y umbrales configurables.
- [ ] Consumidores de rating y moderación idempotentes.
- [ ] Consultas, leaderboard e historial.
- [ ] `recompute` desde el ledger.
- [ ] Tests de duplicados, desorden, clamp y cambio de nivel.
- [ ] `README.md`, `.env.example`, `Dockerfile`, `docker-compose.yml`.
- [ ] Ruta `/api/reputation/**` en el gateway.

## 10. Definition of Done

- [ ] Like +2, dislike -2 y cambio de voto aplica el delta correcto.
- [ ] Bloqueo -10 y advertencia -3, una sola vez por mensaje.
- [ ] Evento duplicado no altera el puntaje.
- [ ] Nivel cambia en los umbrales y `levelChanged` es correcto.
- [ ] Leaderboard ordena y pagina.
- [ ] `recompute` reconstruye el puntaje.
