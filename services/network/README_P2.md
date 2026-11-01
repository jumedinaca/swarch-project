# Network — Cambios para Prototipo 2

> Este documento contiene **solo lo que falta cambiar** en el servicio existente. No repite lo que ya funciona.

## 1. Estado actual

`network` ya gestiona solicitudes de amistad y lista de amigos con Python/FastAPI + Strawberry GraphQL + MongoDB. Confía en `X-User-ID` que agrega el gateway y expone `/graphql`.

## 2. ¿Qué falta para P2?

**Nada obligatorio.** El servicio ya cumple su función y no depende de `color` ni de los componentes nuevos. Los cambios son opcionales y no bloquean la entrega.

### 2.1. Opcional: actividad para el socket

Si se quiere que el frontend reciba actividad de amistad en tiempo real:

- [ ] Agregar `RABBITMQ_URL`.
- [ ] Publicar `activity.created.v1` al enviar, aceptar o rechazar una solicitud.
- [ ] No bloquear la operación GraphQL si RabbitMQ falla; publicar después de la mutación y registrar el error.

Payload sugerido:

```json
{
  "eventId": "0192f3a4-...",
  "eventType": "activity.created.v1",
  "version": 1,
  "occurredAt": "2026-10-24T14:30:00Z",
  "producer": "network",
  "correlationId": "b3b1c2d4-...",
  "payload": {
    "activityId": "6f5e...",
    "userId": "7b8339ec-...",
    "actorId": "9c8d...",
    "type": "FRIEND_REQUEST_ACCEPTED",
    "entityId": "friend-request-id",
    "summary": "Aceptaste una solicitud de amistad",
    "createdAt": "2026-10-24T14:30:00Z"
  }
}
```

- [ ] `socket-gateway` ya tiene `activity.created.v1` en `socket.events.q`.

### 2.2. Sin cambios

- [ ] No cambiar GraphQL ni el esquema de amistades.
- [ ] No cambiar el uso de `X-User-ID`.
- [ ] No agregar `color` ni datos de perfil a MongoDB; el frontend resuelve perfiles con `GET /api/profiles/batch`.
- [ ] No agregar tablas/colecciones de outbox ni de eventos procesados.

## 3. Consejo técnico

- Mantener Python/FastAPI + Strawberry + MongoDB.
- Si se publica actividad, usar `aio-pika` y publicar después de que la mutación haya persistido.
- No hacer llamadas HTTP a `profile` desde los resolvers; el frontend pide los perfiles en lote.

## 4. Definition of Done

- [ ] El servicio sigue funcionando igual sin cambios.
- [ ] Si se implementó actividad, `activity.created.v1` llega a `socket-gateway` y el cliente lo recibe.
- [ ] No se agregaron tablas/colecciones de procesamiento de eventos.
