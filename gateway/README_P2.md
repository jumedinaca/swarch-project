# API Gateway — Cambios para Prototipo 2

> Este documento contiene **solo lo que falta cambiar** en el gateway existente. No repite lo que ya funciona.

## 1. Estado actual

El gateway (Java 21 + Spring Boot 4 + Spring Cloud Gateway) ya enruta auth, messages y network, valida JWT y agrega `X-User-ID`. También elimina cualquier `X-User-ID` enviado por el cliente y maneja CORS.

## 2. Rutas nuevas

Agregar en `src/main/resources/application.yml`, respetando el orden (la primera ruta que coincide gana):

| Ruta pública | Destino | Filtros |
| --- | --- | --- |
| `GET /api/profiles/avatars/**` | `PROFILE_SERVICE_URL` | `StripPrefix=1` (pública) |
| `/api/profiles/**` | `PROFILE_SERVICE_URL` | `StripPrefix=1`, `JwtAuth` |
| `/api/ratings/**` | `RATING_SERVICE_URL` | `StripPrefix=1`, `JwtAuth` |
| `/api/reputation/**` | `REPUTATION_SERVICE_URL` | `StripPrefix=1`, `JwtAuth` |
| `POST /api/socket/tickets` | `SOCKET_GATEWAY_HTTP_URL` | `StripPrefix=2`, `JwtAuth` (→ `/tickets`) |
| `/api/ws` | `SOCKET_GATEWAY_WS_URL` | `StripPrefix=1`; sin `JwtAuth` (ticket) |
| `/api/moderation/**` (opcional) | `MODERATION_SERVICE_URL` | `StripPrefix=1`, `JwtAuth` |

Notas:

- [ ] La ruta de avatares va **antes** de `/api/profiles/**` porque es pública.
- [ ] `/api/socket/tickets` usa `StripPrefix=2` para llegar a `/tickets`; el ticket lo valida el servicio.
- [ ] `/api/ws` es WebSocket: usar `uri` con esquema `ws://` o `wss://`, no `http://`.
- [ ] No enrutar `/internal/*` de ningún servicio.
- [ ] No enrutar `email`; es interno.
- [ ] El gateway no envuelve respuestas: los servicios nuevos devuelven `data` directo y el gateway lo pasa tal cual.

## 3. Variables de entorno nuevas

| Variable | Ejemplo local | Ejemplo Docker |
| --- | --- | --- |
| `PROFILE_SERVICE_URL` | `http://localhost:8300` | `http://profile:8080` |
| `RATING_SERVICE_URL` | `http://localhost:8400` | `http://rating:8080` |
| `REPUTATION_SERVICE_URL` | `http://localhost:8600` | `http://reputation:8080` |
| `MODERATION_SERVICE_URL` | `http://localhost:8500` | `http://moderation:8080` |
| `SOCKET_GATEWAY_HTTP_URL` | `http://localhost:8700` | `http://socket-gateway:8080` |
| `SOCKET_GATEWAY_WS_URL` | `ws://localhost:8700` | `ws://socket-gateway:8080` |

- [ ] No reutilizar una sola variable para HTTP y WS: Spring necesita el esquema correcto.
- [ ] Agregar estas variables al `docker-compose.yml` raíz.

## 4. WebSocket

- [ ] La ruta `/api/ws` no lleva `JwtAuth` porque el navegador no puede enviar `Authorization` en el handshake.
- [ ] El servicio `socket-gateway` valida el ticket efímero.
- [ ] Verificar que Spring Cloud Gateway permita el upgrade (`Connection: Upgrade`, `Upgrade: websocket`).
- [ ] Probar con un cliente WebSocket real, no solo con `curl`.
- [ ] Configurar timeouts de WebSocket si el gateway los aplica por defecto.

## 5. CORS y seguridad

- [ ] El gateway sigue siendo el único que agrega CORS; los servicios nuevos usan `CORS_ORIGINS=""`.
- [ ] Mantener `StripUserIdGlobalFilter` para que el cliente no pueda falsificar `X-User-ID` en las rutas nuevas.
- [ ] No exponer puertos internos en el compose raíz.
- [ ] Mantener el límite de tamaño de subida para avatares (5 MB) o configurarlo en el gateway si aplica.

## 6. Contrato de respuestas

- [ ] `auth`, `messages` y `network` conservan su contrato actual para no romper el frontend.
- [ ] `profile`, `rating`, `reputation` y `socket-gateway` devuelven el dato directo, sin `{ success, data }`.
- [ ] El gateway no transforma cuerpos; solo enruta y traduce autenticación.
- [ ] Errores de los servicios nuevos: `{ "error": "codigo", "message": "texto" }`.

## 7. Tareas

- [ ] Agregar las rutas y variables.
- [ ] Actualizar tests de enrutamiento, JWT y WebSocket.
- [ ] Actualizar `README.md` y `docs/jwt-contract.md` con el flujo de ticket.
- [ ] Probar `GET /api/profiles/avatars/...` sin token y `GET /api/profiles/me` con token.
- [ ] Probar `POST /api/socket/tickets` con token y `/api/ws?ticket=...`.
- [ ] Verificar que `X-User-ID` falso se elimina en las rutas nuevas.

## 8. Definition of Done

- [ ] Todas las rutas nuevas responden a través del gateway.
- [ ] Las rutas protegidas rechazan sin JWT y agregan `X-User-ID`.
- [ ] Los avatares son públicos y cacheables.
- [ ] El WebSocket funciona a través del gateway.
- [ ] No se expone ningún servicio interno al host.
- [ ] Los tests del gateway pasan.
