# Messages — Cambios para Prototipo 2

> Este documento contiene **solo lo que falta cambiar** en el servicio existente. No repite lo que ya funciona.

## 1. Estado actual

`messages` ya crea, consulta, elimina y busca mensajes por proximidad con Go + PostgreSQL/PostGIS. Las respuestas ya devuelven el objeto o el array directamente (sin sobre `{ success, data }`).

## 2. Objetivo de P2

Integrar el mensaje con el flujo de moderación y con el resto del sistema:

1. Crear el mensaje en estado `PENDING`.
2. Publicar `message.submitted.v1`.
3. Recibir la decisión de `moderation`.
4. Publicar `message.published.v1` si queda visible.
5. Excluir de `nearby` los mensajes pendientes, bloqueados o eliminados.

## 3. Cambios de modelo (PostgreSQL `messages`)

Agregar columnas a la tabla existente. **Sin tablas de outbox ni de eventos procesados.**

```sql
ALTER TABLE messages
  ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN moderation_status VARCHAR(16),
  ADD COLUMN moderation_reason TEXT,
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE messages
  ADD CONSTRAINT chk_messages_status
  CHECK (status IN ('PENDING','PUBLISHED','BLOCKED','DELETED'));

CREATE INDEX idx_messages_status ON messages (status);
```

Valores:

- `status`: `PENDING`, `PUBLISHED`, `BLOCKED`, `DELETED`.
- `moderation_status`: `PENDING`, `ALLOW`, `WARN`, `BLOCK`, `REVIEW`, `DEGRADED`.
- `moderation_reason`: texto legible o código; no guardar el contenido del mensaje en logs.

## 4. Reglas de negocio

- [ ] Crear mensaje con `status = PENDING`, `moderation_status = PENDING`.
- [ ] Responder `201` con el mensaje y su estado; el frontend muestra “en revisión”.
- [ ] `GET /messages/nearby` solo devuelve `status = PUBLISHED` (incluye los que tienen `moderation_status = WARN`).
- [ ] `GET /messages/{id}` del dueño puede devolver cualquier estado.
- [ ] `DELETE /messages/{id}` marca `status = DELETED` y publica `message.deleted.v1`.
- [ ] No devolver `authorColor` desde messages; el frontend resuelve autor/color con `profile`.
- [ ] Si la moderación no responde en `MODERATION_TIMEOUT_SECONDS` (por defecto 10 s), aplicar `FAIL_OPEN` o `FAIL_CLOSED` según configuración.
- [ ] Si `FAIL_OPEN=true`: `status = PUBLISHED`, `moderation_status = DEGRADED`, publicar `message.published.v1`.
- [ ] Si `FAIL_CLOSED=true`: `status = BLOCKED`, `moderation_status = BLOCK`.
- [ ] Si el evento `moderation.failed` llega, aplicar la misma política.

## 5. API HTTP

Las rutas existentes se mantienen. **No envolver las respuestas en `{ success, data }`.**

| Método y ruta | Cambio |
| --- | --- |
| `POST /messages` | Crea `PENDING` y publica `message.submitted.v1`. |
| `GET /messages/{id}` | Devuelve `status` y `moderation_status`. |
| `DELETE /messages/{id}` | Marca `DELETED` y publica `message.deleted.v1`. |
| `GET /messages/nearby` | Filtra solo `PUBLISHED`. |
| `GET /health` | Opcional: agregar estado del broker. |

Respuesta de creación (campos nuevos en negrita):

```json
{
  "id": "550e8400-...",
  "sender_id": "7b8339ec-...",
  "content": "Hola desde la Plaza Che",
  "location": { "latitude": 4.6371, "longitude": -74.0834 },
  "created_at": "2026-10-24T14:30:00Z",
  "status": "PENDING",
  "moderation_status": "PENDING",
  "version": 1
}
```

El frontend actual mapea `status` a `pendiente|publicado|oculto|eliminado`; mantener esa compatibilidad en el adaptador.

## 6. Eventos

**Publica**

- `message.submitted.v1` al crear.
- `message.published.v1` cuando queda visible (`ALLOW`, `WARN` o `DEGRADED`).
- `message.deleted.v1` al borrar.
- `message.edited.v1` solo si se implementa edición (opcional en P2).

**Consume**

- `messages.moderation.completed.q` ← `moderation.completed.v1`.
- `messages.moderation.failed.q` ← `moderation.failed.v1`.

Payload `message.submitted.v1`:

```json
{
  "eventId": "0192f3a4-...",
  "eventType": "message.submitted.v1",
  "version": 1,
  "occurredAt": "2026-10-24T14:30:00Z",
  "producer": "messages",
  "correlationId": "b3b1c2d4-...",
  "causationId": null,
  "payload": {
    "messageId": "550e8400-...",
    "authorId": "7b8339ec-...",
    "content": "Hola desde la Plaza Che",
    "latitude": 4.6371,
    "longitude": -74.0834,
    "messageVersion": 1,
    "createdAt": "2026-10-24T14:30:00Z"
  }
}
```

Payload `message.published.v1`:

```json
{
  "eventType": "message.published.v1",
  "payload": {
    "messageId": "550e8400-...",
    "authorId": "7b8339ec-...",
    "contentPreview": "Hola desde la Plaza Che",
    "latitude": 4.6371,
    "longitude": -74.0834,
    "moderationDecision": "ALLOW",
    "publishedAt": "2026-10-24T14:30:02Z"
  }
}
```

- [ ] Publicar después del commit. **Sin outbox en P2**: si RabbitMQ falla, se registra el error.
- [ ] Para no dejar mensajes `PENDING` para siempre, un job interno puede buscar `PENDING` con `created_at < now() - timeout` y republicar `message.submitted` o aplicar fail-open. Usa la propia tabla `messages`; no crear tabla de eventos.

## 7. Consejo técnico

- Mantener Go + `pgx` + `amqp091-go` + `goose`.
- El consumidor de moderación debe ser idempotente por `messageId + messageVersion`: actualizar solo si la versión coincide y el estado actual es `PENDING`.
- Usar `UPDATE ... WHERE id = $1 AND version = $2 AND status = 'PENDING'` para evitar aplicar decisiones viejas.
- No consultar `auth` ni `profile` desde messages para armar la respuesta; el frontend resuelve perfiles con `GET /api/profiles/batch`.
- El contenido se guarda completo; en logs solo `messageId` y estado.

## 8. Tareas

- [ ] Migración de columnas y constraint.
- [ ] Cambiar creación a `PENDING`.
- [ ] Publicar `message.submitted` después del commit.
- [ ] Consumidor de `moderation.completed`/`moderation.failed`.
- [ ] Publicar `message.published` y `message.deleted`.
- [ ] Filtrar `nearby` por `PUBLISHED`.
- [ ] Agregar timeout/fail-open para mensajes pendientes.
- [ ] Actualizar tests, README y frontend.
- [ ] Agregar `RABBITMQ_URL` al compose y `.env.example`.

## 9. Definition of Done

- [ ] Un mensaje limpio pasa a `PUBLISHED` y aparece en `nearby`.
- [ ] Un mensaje bloqueado no aparece en `nearby`.
- [ ] Un mensaje con advertencia aparece con `moderation_status = WARN`.
- [ ] El dueño ve el estado de su mensaje.
- [ ] Un mensaje pendiente no aparece en `nearby`.
- [ ] Si RabbitMQ está caído, crear mensaje no rompe el servicio (queda `PENDING` y se registra el error).
- [ ] No hay tablas de outbox ni de eventos procesados.
