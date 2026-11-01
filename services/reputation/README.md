# GeoPicto — Microservicio de Reputación

El microservicio de **Reputación** calcula, actualiza y expone el puntaje y nivel de reputación de cada usuario en GeoPicto. Funciona de manera asíncrona procesando eventos del broker (**RabbitMQ**) emitidos por los microservicios de `rating` y `moderation`, y expone una API HTTP REST que el **API Gateway** publica hacia el frontend.

---

## 1. Arquitectura y Componentes

Basado en el diagrama arquitectural del sistema (**C&C view — Geopicto**), este microservicio consta de:

```
                      ┌───────────────────────────┐
                      │ geopicto-web / mobile     │
                      └─────────────┬─────────────┘
                                    │
                                    ▼
                      ┌───────────────────────────┐
                      │        api-gateway        │
                      └─────────────┬─────────────┘
                                    │ HTTP REST (/api/reputation/**)
                                    ▼
┌──────────────────┐    ┌────────────────────────────────────────┐    ┌──────────────────┐
│ broker           ├───►│ reputation (Go 1.27)                   ├───►│ broker           │
│ (RabbitMQ)       │AMQP│  - AMQP Consumer (rating, moderation)  │AMQP│ (RabbitMQ)       │
└──────────────────┘    │  - Calculation & Clamping Engine       │    └──────────────────┘
 rating.changed.v1      │  - Event Publisher                     │     reputation.changed.v1
 moderation.completed.v1│  - REST HTTP Server                    │
                        └───────────────────┬────────────────────┘
                                            │ SQL (pgx)
                                            ▼
                                ┌────────────────────────┐
                                │ reputation-db          │
                                │ (PostgreSQL 18)        │
                                └────────────────────────┘
```

### Capas del Microservicio (Arquitectura Hexagonal / Puertos y Adaptadores)
* **`internal/domain`**: Entidades y reglas de cálculo puro (clamping 0–1000, umbrales de niveles y cálculo de progreso).
* **`internal/service`**: Casos de uso de negocio, deduplicación e idempotencia, lógica de transición WARN a BLOCK, y reconstrucción (`recompute`).
* **`internal/repository`**: Persistencia relacional en PostgreSQL utilizando transacciones con bloqueo pesimista (`SELECT ... FOR UPDATE`) sobre la fila del usuario.
* **`internal/messaging`**: Consumo asíncrono con confirmación manual (`ack/nack`) y publicación de eventos hacia el exchange `geopicto.events`.
* **`internal/handler`**: Controladores HTTP REST con respuestas directas (sin envoltorio `{ success, data }`).

---

## 2. Reglas de Negocio

### Deltas de Puntuación
| Evento / Acción | Delta | Motivo (`reason`) |
| --- | --- | --- |
| Like recibido | `+2` | `LIKE_RECEIVED` |
| Dislike recibido | `-2` | `DISLIKE_RECEIVED` |
| Cambio de voto | `(value - previousValue) * 2` | `LIKE_RECEIVED` / `DISLIKE_RECEIVED` |
| Voto a mensaje propio | `0` (ignorado) | — |
| Mensaje aprobado (`ALLOW`) | `+1` (una vez por mensaje) | `MESSAGE_ALLOWED` |
| Mensaje con advertencia (`WARN`) | `-3` (una vez por mensaje) | `MESSAGE_WARNED` |
| Mensaje bloqueado (`BLOCK`) | `-10` (una vez por mensaje) | `MESSAGE_BLOCKED` |
| Transición `WARN` → `BLOCK` | `-7` (diferencia para totalizar -10) | `MESSAGE_BLOCKED` |
| `REVIEW` o `DEGRADED` | `0` (ignorado) | — |

* **Rango:** El puntaje siempre se clampea entre `0` y `1000`.
* **Idempotencia:** Restricción de unicidad en `reputation_ledger.source_event_id` y en `(user_id, dedupe_key)`. Los eventos duplicados no modifican el puntaje ni el ledger, y son confirmados (`ack`) de forma limpia.

### Niveles y Umbrales
| Puntaje | Nivel | `levelIndex` | `nextLevelAt` | Progreso (`progress`) |
| --- | --- | --- | --- | --- |
| 0–49 | Novato | 0 | 50 | `score / 50.0` |
| 50–149 | Miembro | 1 | 150 | `(score - 50) / 100.0` |
| 150–349 | Confiable | 2 | 350 | `(score - 150) / 200.0` |
| 350–699 | Experto | 3 | 700 | `(score - 350) / 350.0` |
| 700–1000 | Leyenda | 4 | `null` | `1.0` |

---

## 3. Modelo de Datos (PostgreSQL)

El servicio no requiere tablas de outbox ni de `processed_events`. La tabla de negocio `reputation_ledger` funge como fuente inmutable de verdad:

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

CREATE INDEX idx_reputation_ledger_user_created ON reputation_ledger (user_id, created_at DESC);
CREATE INDEX idx_user_reputation_score ON user_reputation (score DESC, updated_at DESC);
```

---

## 4. Contrato de Eventos (RabbitMQ)

* **Exchange:** `geopicto.events` (Topic, durable)
* **Colas consumidoras:**
  * `reputation.rating.changed.q` con routing key `rating.changed.v1`
  * `reputation.moderation.completed.q` con routing key `moderation.completed.v1`
* **Evento publicado tras confirmación:**
  * `reputation.changed.v1`

### Ejemplo de evento publicado (`reputation.changed.v1`):
```json
{
  "eventId": "78091413-9539-433a-9ee0-0a2a6516ef4c",
  "eventType": "reputation.changed.v1",
  "version": 1,
  "occurredAt": "2026-11-01T02:36:20Z",
  "producer": "reputation",
  "correlationId": "b3b1c2d4-0000-0000-0000-000000000001",
  "causationId": "0192f3a4-0001-7000-8000-000000000001",
  "payload": {
    "userId": "11111111-1111-1111-1111-111111111111",
    "previousScore": 0,
    "score": 2,
    "delta": 2,
    "previousLevel": "Novato",
    "level": "Novato",
    "levelChanged": false,
    "reason": "LIKE_RECEIVED",
    "sourceEventId": "0192f3a4-0001-7000-8000-000000000001",
    "occurredAt": "2026-11-01T02:36:20Z"
  }
}
```

---

## 5. API HTTP REST

Las respuestas devuelven directamente el recurso solicitado (sin envoltorio `{ success, data }`).

| Método | Ruta interna | Cabecera / Parámetros | Descripción |
| --- | --- | --- | --- |
| `GET` | `/reputation/me` | `X-User-ID: <UUID>` | Reputación del usuario en sesión. Devuelve `score: 0`, `"Novato"` si no existe en BD. |
| `GET` | `/reputation/{userId}` | Parámetro de ruta `{userId}` | Reputación de un usuario específico. |
| `GET` | `/reputation/leaderboard` | `limit` (default 20), `cursor` | Leaderboard ordenado por puntaje descendente. |
| `GET` | `/reputation/{userId}/history` | `limit` (default 20), `cursor` | Historial paginado de movimientos en el ledger. |
| `POST` | `/reputation/{userId}/recompute` | Parámetro `{userId}` | Reconstruye el puntaje a partir de todos los registros del ledger. |
| `GET` | `/health` | Ninguno | Estado del servicio, base de datos y broker. |

### Ejemplo de respuesta de reputación (`GET /reputation/me` o `GET /reputation/{userId}`):
```json
{
  "userId": "11111111-1111-1111-1111-111111111111",
  "score": 120,
  "level": "Miembro",
  "levelIndex": 1,
  "nextLevelAt": 150,
  "progress": 0.7,
  "likesReceived": 60,
  "dislikesReceived": 5,
  "messagesBlocked": 1,
  "messagesWarned": 2,
  "updatedAt": "2026-11-01T02:36:20Z"
}
```

---

## 6. Pruebas y Verificación

### Pruebas Unitarias y E2E
Ejecuta la suite completa de pruebas:
```bash
go test -v ./...
```

### Probar con cURL / PowerShell (Servicio en contenedor)
```bash
# 1. Comprobar salud
curl -s http://localhost:8600/health

# 2. Consultar reputación propia
curl -s http://localhost:8600/reputation/me -H "X-User-ID: 11111111-1111-1111-1111-111111111111"

# 3. Consultar historial del ledger
curl -s http://localhost:8600/reputation/11111111-1111-1111-1111-111111111111/history

# 4. Consultar leaderboard
curl -s http://localhost:8600/reputation/leaderboard

# 5. Ejecutar recomputación
curl -s -X POST http://localhost:8600/reputation/11111111-1111-1111-1111-111111111111/recompute
```
