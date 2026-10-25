# Socket Gateway — Requisitos Prototipo 2

> Componente pendiente. Mantiene las conexiones WebSocket y empuja notificaciones/actividad a los usuarios en tiempo real.
>
> **Este es el componente recomendado para el quinto lenguaje: Elixir + Phoenix Channels.** Si el equipo decide hacerlo en Node.js, el quinto lenguaje debe cubrirse con Rust en `rating` o `reputation`.

## 1. Propósito

Mantener conexiones WebSocket autenticadas, permitir suscripciones a tópicos y consumir eventos de RabbitMQ para enviarlos a los clientes conectados. Los demás componentes no llaman a este servicio por HTTP: publican eventos al broker.

## 2. Alcance

**Incluye**

- [ ] Endpoint WebSocket autenticado por ticket efímero.
- [ ] Tópicos `user:<id>`, `message:<id>` y `global`.
- [ ] Consumo de `socket.events.q` y push a clientes.
- [ ] Heartbeat, reconexión, límites y backpressure.
- [ ] Presencia básica en Redis (opcional).
- [ ] Ticket endpoint para el frontend.
- [ ] `/health` y `/metrics` opcional.

**No incluye**

- Persistencia de notificaciones.
- Chat en tiempo real.
- Llamadas de audio/vídeo.
- Lógica de negocio.

## 3. Autenticación WebSocket

El navegador no puede enviar `Authorization` en el handshake. Flujo:

1. Frontend: `POST /api/socket/tickets` con `Authorization: Bearer <access token>`.
2. Gateway valida JWT y reenvía a `POST /tickets` con `X-User-ID`.
3. Servicio genera ticket opaco (32 bytes), lo guarda en Redis `ticket:<ticket> -> userId` con TTL 60 s.
4. Frontend abre `ws://localhost:8080/api/ws?ticket=<ticket>` (producción `wss://`).
5. Servicio valida, borra el ticket (one-time use) y asocia la conexión al `userId`.
6. Ticket inválido/expirado → cierre `4401`/`4408`.

- [ ] No aceptar `?token=<access token>` en producción; solo fallback de desarrollo documentado.
- [ ] No registrar tickets en logs.
- [ ] TTL 60 s, un solo uso.
- [ ] Si Redis no está disponible, no aceptar conexiones nuevas (fail-closed) y reportar `503` en `/health`.
- [ ] Validar `Origin` contra `WS_ALLOWED_ORIGINS`.

## 4. API HTTP/WS

| Método y ruta | Autenticación | Respuesta |
| --- | --- | --- |
| `POST /tickets` | JWT vía gateway | `{ "ticket": "...", "expiresIn": 60 }` directo, sin envelope. |
| `GET /ws?ticket=` | Ticket | Handshake WebSocket. |
| `GET /health` | — | Estado, conexiones, Redis, RabbitMQ. |
| `GET /metrics` | — | Opcional Prometheus. |
| `POST /internal/publish` | `X-Internal-Token` | Solo pruebas. |

**Las respuestas HTTP exitosas devuelven el dato directo, sin `{ success, data }`.**

## 5. Protocolo WebSocket

JSON, máximo 16 KB por frame.

**Cliente → servidor**

```json
{ "type": "subscribe", "requestId": "1", "topics": ["user:7b8339ec-...", "message:550e8400-..."] }
{ "type": "unsubscribe", "requestId": "2", "topics": ["message:550e8400-..."] }
{ "type": "ping", "ts": 1791763200000 }
```

**Servidor → cliente**

```json
{ "type": "ready", "connectionId": "c-123", "userId": "7b8339ec-..." }
{ "type": "event", "eventId": "0192f3a4-...", "event": "notification.requested.v1", "occurredAt": "2026-10-24T14:30:00Z", "payload": {} }
{ "type": "pong", "ts": 1791763200000 }
{ "type": "error", "code": "forbidden_topic", "message": "No puedes suscribirte a ese tópico" }
```

Reglas:

- [ ] Solo `user:<propio id>` para tópicos privados.
- [ ] `message:<id>` y `global` públicos para autenticados.
- [ ] Máximo 5 conexiones por usuario.
- [ ] Heartbeat cada 30 s; cerrar si no hay `pong` en 90 s.
- [ ] Rate limit 10 mensajes/s por conexión.
- [ ] Backpressure: buffer por conexión; si se llena, descartar o cerrar; nunca bloquear el servidor.
- [ ] Códigos: `4401` no autenticado, `4408` ticket expirado, `4429` rate limit, `1013` ocupado, `1011` interno.
- [ ] Cliente reconecta con backoff 1–30 s + jitter, pide ticket nuevo y se re-suscribe.
- [ ] Entrega at-most-once; el frontend reconcilia por HTTP tras reconectar.

## 6. Mapeo de eventos a tópicos

| Evento | Tópico(s) |
| --- | --- |
| `notification.requested.v1` | `user:<userId>` |
| `activity.created.v1` | `user:<userId>` |
| `reputation.changed.v1` | `user:<userId>` |
| `moderation.completed.v1` | `user:<authorId>` y `message:<messageId>` |
| `rating.changed.v1` | `message:<messageId>` y `user:<messageAuthorId>` |
| `message.published.v1` | `global` y `user:<authorId>` |
| `profile.updated.v1` | `user:<userId>` (opcional) |

- [ ] Si falta `userId`/`messageId`, no empujar y registrar warning.
- [ ] No reenviar contenido completo; solo `contentPreview` ≤ 140 caracteres.

## 7. Estado en Redis

- `ticket:<ticket>` → `userId`, TTL 60 s.
- `presence:<userId>` → `connectionId`, TTL 60 s (opcional).
- Canal Pub/Sub `geopicto:realtime` para fanout entre instancias.

- [ ] Una instancia: Redis solo para tickets/presencia.
- [ ] Varias instancias: el consumidor de `socket.events.q` publica en Redis y cada instancia empuja a sus conexiones locales.
- [ ] Sin Redis Pub/Sub: exchange `geopicto.realtime` (fanout) y cola `socket.instance.<INSTANCE_ID>.q` por instancia.

## 8. Requisitos no funcionales

- [ ] p95 de entrega < 1 s.
- [ ] 10 000 conexiones por instancia en prueba de carga (objetivo).
- [ ] Reconexión sin pérdida de suscripciones (el cliente las repite).
- [ ] No caerse si RabbitMQ/Redis se reinician; reconectar con backoff.
- [ ] `/health` reporta `degraded` si RabbitMQ cae pero las conexiones siguen.
- [ ] Logs sin tickets ni tokens.

## 9. Consejo técnico: el quinto lenguaje

**Recomendado: Elixir 1.18 + Phoenix 1.8 + Phoenix Channels + Bandit + `broadway_rabbitmq` (o `amqp`) + `Redix` + `jason`.**

Por qué:

- BEAM/OTP está diseñado para miles de conexiones ligeras y reconexión supervisada.
- Phoenix Channels ya resuelve tópicos, heartbeat, presencia y backpressure.
- Aporta el quinto lenguaje: Java (gateway), Go (messages), Python (auth/network/profile/moderation/email), TypeScript (frontend) y **Elixir**.
- `broadway_rabbitmq` da consumidores concurrentes con ack/reintentos; si el equipo no lo conoce, `amqp` directo alcanza.

**Alternativa: Node.js 22 + `ws` (o Socket.IO) + `amqplib` + `ioredis`.**

- Es la opción más rápida si el equipo domina TypeScript.
- No aporta lenguaje nuevo. En ese caso, hacer `reputation` en Rust (Axum + SQLx + `lapin`) o `rating` en Rust.
- Si se usa Socket.IO, configurar adaptador Redis y sticky sessions; con WebSocket nativo no hace falta.

**Trampas**

- No autenticar con access token en query string en producción.
- No usar una cola compartida con consumidores competidores sin fanout.
- No hacer `await` de un cliente lento dentro del consumidor.
- No confiar en que el cliente está vivo.
- No poner lógica de negocio aquí.
- En SSR, abrir WebSocket solo en `useEffect`.

## 10. Tareas

- [ ] Crear `services/socket-gateway` con Dockerfile multi-stage.
- [ ] Implementar `POST /tickets` con Redis y TTL.
- [ ] Implementar `/ws`, tópicos, heartbeat y límites.
- [ ] Consumidor de `socket.events.q` y mapeo de eventos.
- [ ] Fanout con Redis Pub/Sub (o colas por instancia).
- [ ] Tests de autenticación, tópicos, heartbeat y backpressure.
- [ ] `README.md`, `.env.example`, `docker-compose.yml`.
- [ ] Rutas del gateway: `/api/socket/tickets` (JWT) y `/api/ws` (ticket).

## 11. Definition of Done

- [ ] El frontend obtiene ticket y abre WebSocket por el gateway.
- [ ] Un like genera `rating.changed` y el cliente suscrito recibe el evento en < 1 s.
- [ ] Un cambio de nivel genera `reputation.changed`.
- [ ] Un mensaje bloqueado notifica al autor.
- [ ] Al reiniciar, el cliente reconecta y se re-suscribe.
- [ ] Un usuario no puede suscribirse al tópico privado de otro.
