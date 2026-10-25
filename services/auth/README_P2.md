# Auth — Cambios para Prototipo 2

> Este documento contiene **solo lo que falta cambiar** en el servicio existente. No repite lo que ya funciona.

## 1. Estado actual

`auth` ya gestiona registro, login, JWT, refresh tokens, sesiones, bloqueo por intentos y logout. Está en Python/FastAPI + PostgreSQL y el gateway valida sus JWT.

## 2. Decisión de P2

`auth` deja de manejar datos públicos. **Solo conserva lo necesario para autenticar**:

- `id`, `username`, `email`, contraseña, estado de la cuenta, sesiones y tokens.
- **Ya no maneja `color`**, ni nombre visible, ni biografía, ni avatar.
- `profile` pasa a ser dueño de `displayName`, `about`, `avatarUrl` y `color`.

## 3. Cambios obligatorios

### 3.1. Quitar `color`

- [ ] Migración Alembic para eliminar la columna `color` de `users`.
- [ ] Quitar `color` del modelo `User`, schemas Pydantic, respuestas de login/registro/perfil y tests.
- [ ] Quitar `color` del JWT si se estuviera incluyendo (hoy no se incluye; verificar).
- [ ] Actualizar el frontend: `User` ya no tiene `color`; el color se obtiene de `profile`.
- [ ] El color de autor se genera/migra en `profile` (no en auth).

### 3.2. Eliminar `PATCH /auth/profile`

- [ ] Eliminar la ruta `PATCH /auth/profile` (hoy solo cambia color).
- [ ] Eliminar su handler, schema y tests.
- [ ] Actualizar `frontend/src/config/api.config.ts` y `authService` para no llamarla.
- [ ] La edición de perfil pasa a `PATCH /api/profiles/me`.

`GET /auth/profile` puede quedarse, pero devuelve solo identidad (auth conserva su sobre actual):

```json
{
  "success": true,
  "data": {
    "id": "7b8339ec-...",
    "username": "ExploradorGeo",
    "email": "explorador@geochat.org",
    "isActive": true,
    "createdAt": "2026-10-12T00:38:01Z"
  },
  "message": null
}
```

### 3.3. Publicar eventos de identidad

- [ ] Agregar `RABBITMQ_URL` a `.env.example`, README y compose.
- [ ] Publicar `user.registered.v1` después del commit del registro.
- [ ] Publicar `user.updated.v1` si se implementa cambio de `username` (hoy no existe endpoint; si no se implementa, dejar el evento documentado pero no publicarlo).
- [ ] No publicar `color`.
- [ ] Para P2 **no se implementa outbox ni tabla de eventos procesados**: se publica después del commit. Si RabbitMQ falla, el registro no debe fallar; se registra el error y se puede reintentar manualmente.
- [ ] Los eventos usan el sobre común (`eventId`, `eventType`, `version`, `occurredAt`, `producer`, `correlationId`, `causationId`, `payload`).

Payload `user.registered.v1`:

```json
{
  "eventId": "0192f3a4-...",
  "eventType": "user.registered.v1",
  "version": 1,
  "occurredAt": "2026-10-24T14:30:00Z",
  "producer": "auth",
  "correlationId": "b3b1c2d4-...",
  "causationId": null,
  "payload": {
    "userId": "7b8339ec-...",
    "username": "ExploradorGeo",
    "email": "explorador@geochat.org",
    "registeredAt": "2026-10-24T14:30:00Z"
  }
}
```

Payload `user.updated.v1` (si aplica):

```json
{
  "eventType": "user.updated.v1",
  "payload": {
    "userId": "7b8339ec-...",
    "username": "NuevoNombre",
    "changedFields": ["username"],
    "updatedAt": "2026-10-24T14:30:00Z"
  }
}
```

### 3.4. Mantener el contrato HTTP actual

- [ ] **No cambiar** el sobre `{ success, data, message }` de auth en P2: el frontend actual ya lo consume y cambiarlo rompería login/registro.
- [ ] Los servicios nuevos sí devuelven el dato directo; el frontend normaliza ambos formatos.
- [ ] No cambiar rutas, códigos de error ni el contrato JWT (`docs/jwt-contract.md`).

## 4. Modelo de datos

- [ ] `users`: eliminar `color`.
- [ ] `sessions`: sin cambios.
- [ ] No agregar tablas de outbox ni de eventos procesados.

## 5. Variables de entorno nuevas

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `RABBITMQ_URL` | Sí para P2 | `amqp://geopicto:geopicto@rabbitmq:5672/geopicto` |
| `RABBITMQ_EXCHANGE` | No | Por defecto `geopicto.events`. |

## 6. Tareas

- [ ] Migración para quitar `color`.
- [ ] Actualizar modelo, schemas, servicio, handler y tests.
- [ ] Eliminar `PATCH /auth/profile`.
- [ ] Agregar publicación de `user.registered` (y `user.updated` si aplica).
- [ ] Agregar `RABBITMQ_URL` y cliente `aio-pika`.
- [ ] Actualizar README y `.env.example`.
- [ ] Actualizar frontend para no depender de `user.color` ni de `PATCH /auth/profile`.
- [ ] Probar registro con RabbitMQ caído: debe responder 201 igualmente.

## 7. Definition of Done

- [ ] Registro y login siguen funcionando igual.
- [ ] `users` ya no tiene `color` y ninguna respuesta de auth lo devuelve.
- [ ] `PATCH /auth/profile` ya no existe.
- [ ] Al registrarse se publica `user.registered.v1` sin color.
- [ ] `profile` y `email` reciben el evento y actúan.
- [ ] El frontend inicia sesión y obtiene el color desde `profile`.
- [ ] No hay tablas de outbox ni de eventos procesados.
