# Reputation — Requisitos Prototipo 2

> Componente implementado. Mantiene el puntaje y el nivel de reputación de cada usuario a partir de ratings y decisiones de moderación.

## 1. Propósito

Calcular y exponer la reputación de los usuarios, llevar un historial de movimientos y emitir `reputation.changed.v1` cuando el puntaje o el nivel cambian.

## 2. Alcance

**Incluye**

- [x] Puntaje 0–1000 por usuario.
- [x] Niveles derivados del puntaje.
- [x] Ledger de movimientos (tabla de negocio, no de procesamiento de eventos).
- [x] Consumo de `rating.changed.v1` y `moderation.completed.v1`.
- [x] Consulta individual, `me`, leaderboard e historial.
- [x] Publicación de `reputation.changed.v1`.

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

- [x] Puntaje inicial `0`; rango `0..1000`.
- [x] El autor no recibe puntos por votar su propio mensaje (rating ya lo impide).
- [x] No se otorgan puntos por votar, solo por recibir votos.
- [x] Delta por cambio de voto: `(value - previousValue) * 2`.
- [x] Ignorar eventos donde `raterId == messageAuthorId`.
- [x] Cap diario opcional: máximo `+30` por likes recibidos/día.
- [x] Idempotencia: `source_event_id` único en el ledger y `dedupe_key` único por usuario/evento de negocio.
- [x] Si un mensaje pasa de `WARN` a `BLOCK`, aplicar la diferencia según una regla documentada.

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
| `POST /reputation/{userId}/recompute` | JWT | Objeto reputación recalculado. |
| `GET /health` | — | Estado, BD y broker. |

```json
{
  "userId": "7b8339ec-2e38-47b3-9d3b-7643652f1fc7",
  "score": 120,
  "level": "Miembro",
  "levelIndex": 1,
  "nextLevelAt": 150,
  "progress": 0.7,
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

- [x] `reason`: `LIKE_RECEIVED`, `DISLIKE_RECEIVED`, `MESSAGE_ALLOWED`, `MESSAGE_WARNED`, `MESSAGE_BLOCKED`, `ADMIN_ADJUSTMENT`.
- [x] `applied_delta` refleja el clamp/cap.
- [x] `GET` de usuario sin fila devuelve `score: 0`, `level: "Novato"` (no 404).

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

- [x] Publicar después del commit. Sin outbox en P2; si RabbitMQ falla, se registra el error.
- [x] El ledger es la fuente de verdad; el puntaje se puede reconstruir desde él.

## 7. Requisitos no funcionales

- [x] p95 < 100 ms en consultas y < 200 ms por evento.
- [x] Soportar 300 eventos/s en local.
- [x] Consumidor idempotente y tolerante al desorden.
- [x] Reconstrucción desde el ledger (`recompute`) sin downtime.
- [x] No usar `UPDATE score = score + delta` sin ledger.
- [x] Si se clampea, registrar `applied_delta` distinto de `delta`.

## 8. Consejo técnico

**Implementado:** Go 1.27 + `pgx/v5` + `golang-migrate` + `amqp091-go` + `slog`.

- Consumidor simple y eficiente; mismo patrón que `messages`/`rating`.
- `pgx` facilita transacciones: insertar ledger, verificar unique, actualizar `user_reputation`.
- `SELECT ... FOR UPDATE` sobre `user_reputation` para serializar cambios del mismo usuario.

## 9. Tareas

- [x] Crear `services/reputation` con capas `handler`, `service`, `repository`, `consumer`.
- [x] Migraciones de `user_reputation` y `reputation_ledger`.
- [x] Función de nivel y umbrales configurables.
- [x] Consumidores de rating y moderación idempotentes.
- [x] Consultas, leaderboard e historial.
- [x] `recompute` desde el ledger.
- [x] Tests de duplicados, desorden, clamp y cambio de nivel.
- [x] `README.md`, `.env.example`, `Dockerfile`, `docker-compose.yml`.
- [x] Ruta `/api/reputation/**` en el gateway documentada y probada.

## 10. Definition of Done

- [x] Like +2, dislike -2 y cambio de voto aplica el delta correcto.
- [x] Bloqueo -10 y advertencia -3, una sola vez por mensaje.
- [x] Evento duplicado no altera el puntaje.
- [x] Nivel cambia en los umbrales y `levelChanged` es correcto.
- [x] Leaderboard ordena y pagina.
- [x] `recompute` reconstruye el puntaje.
