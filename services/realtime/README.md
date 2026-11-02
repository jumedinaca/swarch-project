# GeoPicto — Microservicio Realtime (`socket-gateway`)

Mantiene las conexiones WebSocket autenticadas por ticket efímero, gestiona suscripciones a tópicos (`user:<id>`, `message:<id>`, `global`) y consume eventos asíncronos de RabbitMQ (`socket.events.q`) para empujarlos a los clientes en tiempo real con fanout sobre Redis Pub/Sub.

Elixir 1.18 (OTP 27) · `Bandit` · `Plug` · `WebSockAdapter` · Redis (`Redix`) · RabbitMQ (`amqp`) · `Jason`.

> **Quinto lenguaje de programación del sistema:** Este componente aporta **Elixir** junto a Java (`gateway`), Go (`messages`, `rating`, `reputation`), Python (`auth`, `network`, `profile`, `moderation`, `email`) y TypeScript (`frontend`).

## Estructura

```
config/                     configuración de compilación y variables de entorno (runtime.exs)
lib/realtime/
  application.ex            árbol de supervisión OTP (Registries, Redix, RabbitConsumer, Bandit)
  config.ex                 lectura tipada de parámetros de ejecución
  metrics.ex                contadores ETS y exposición en formato Prometheus
  event_router.ex           autorización de tópicos, mapeo de eventos y truncado de contentPreview (<= 140)
  dispatcher.ex             registro local de suscripciones y límite de conexiones por usuario
  redis.ex                  tickets one-time en Redis (TTL 60 s), presencia y Pub/Sub geopicto:realtime
  rabbit_consumer.ex        consumidor resiliente con reconexión backoff sobre socket.events.q
  ws_socket.ex              protocolo WebSocket (ready, subscribe, unsubscribe, ping/pong, rate-limit, backpressure)
  router.ex                 endpoints HTTP (/tickets, /ws, /health, /metrics, /internal/publish)
test/                       pruebas unitarias y de integración (ExUnit)
```

## API HTTP y WebSocket

Rutas publicadas en el API Gateway bajo `POST /api/socket/tickets` (con `JwtAuth`) y `GET /api/ws?ticket=<ticket>`. Las respuestas HTTP exitosas devuelven el dato directo, sin `{ success, data }`.

| Método y ruta | Autenticación | Respuesta |
| --- | --- | --- |
| `POST /tickets` | `X-User-ID` (vía Gateway JWT) | `{ "ticket": "...", "expiresIn": 60 }` |
| `GET /ws?ticket=` | Ticket efímero (1 solo uso) | Handshake WebSocket (101 Switching Protocols) |
| `GET /health` | — | `{ "status": "ok\|degraded\|unavailable", "connections": N, "redis": "up\|down", "rabbitmq": "up\|down" }` (`503` si Redis cae) |
| `GET /metrics` | — | Métricas Prometheus (`text/plain`) |
| `POST /internal/publish` | `X-Internal-Token` | `{ "published": true, "topics": [...], "eventId": "...", "event": "..." }` |

## Protocolo WebSocket

Frames JSON de máximo 16 KB.

**Cliente → Servidor**
```json
{ "type": "subscribe", "requestId": "1", "topics": ["user:7b8339ec-...", "message:550e8400-...", "global"] }
{ "type": "unsubscribe", "requestId": "2", "topics": ["message:550e8400-..."] }
{ "type": "ping", "ts": 1791763200000 }
```

**Servidor → Cliente**
```json
{ "type": "ready", "connectionId": "c-1a2b3c4d5e6f", "userId": "7b8339ec-..." }
{ "type": "event", "eventId": "0192f3a4-...", "event": "rating.changed.v1", "occurredAt": "2026-10-24T14:30:00Z", "payload": {} }
{ "type": "pong", "ts": 1791763200000 }
{ "type": "error", "code": "forbidden_topic", "message": "No puedes suscribirte a ese tópico" }
```

## Ejecutar aislado

```bash
cd services/realtime
docker compose up --build
```

Servicio en `http://localhost:8700`, Redis en `6379` y RabbitMQ en `5674` (consola en `http://localhost:15674`, usuario/clave `geopicto`).

### Emitir ticket y publicar evento de prueba

```bash
USER_ID=11111111-1111-1111-1111-111111111111

# 1. Solicitar ticket efímero
TICKET=$(curl -s -X POST localhost:8700/tickets -H "X-User-ID: $USER_ID" | sed -E 's/.*"ticket":"([^"]+)".*/\1/')

# 2. Publicar un evento simulado
curl -X POST localhost:8700/internal/publish \
  -H "X-Internal-Token: dev-internal-token" \
  -H "Content-Type: application/json" \
  -d "{\"eventId\":\"0192f3a4-0000-4000-8000-000000000001\",\"eventType\":\"reputation.changed.v1\",\"payload\":{\"userId\":\"$USER_ID\",\"score\":150,\"level\":\"Confiable\",\"levelChanged\":true}}"
```

## Pruebas

```bash
mix test
```
