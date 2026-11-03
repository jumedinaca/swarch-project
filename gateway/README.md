# API Gateway

## Propósito y estado

Este componente es el punto único de entrada para el frontend: enruta las peticiones hacia los microservicios internos de autenticación (`/api/auth/*`), mensajes (`/api/messages/*`), red social (`/api/network/graphql`), perfiles (`/api/profiles/*`), calificaciones (`/api/ratings/*`), reputación (`/api/reputation/*`) y tiempo real (`/api/socket/tickets` y `/api/ws`). Valida los JWT emitidos por el servicio de autenticación, agrega el header `X-User-ID` y conserva `Authorization` para que `messages`, `network` y `profile` también verifiquen el token. `rating` y `reputation` confían en el `X-User-ID` que agrega el gateway, y `socket-gateway` autentica el WebSocket con un ticket efímero. Está escrito en Java 21 con Spring Boot 4 y Spring Cloud Gateway (reactivo, sobre WebFlux). El formato de los tokens está en [`docs/jwt-contract.md`](../docs/jwt-contract.md).

El código se organiza así:

- `GatewayApplication`: arranque de la aplicación Spring Boot.
- `src/main/resources/application.yml`: definición declarativa de rutas, CORS, el secreto JWT y el endpoint de salud.
- `filter/JwtAuthGatewayFilterFactory`: filtro de ruta `JwtAuth` que exige `Authorization: Bearer <token>`, lo valida, agrega `X-User-ID: <sub>` y conserva `Authorization` para que `messages`, `network` y `profile` vuelvan a verificar el JWT. Sus errores se responden como JSON `{"message": "..."}`.
- `filter/StripUserIdGlobalFilter`: elimina en todas las rutas cualquier `X-User-ID` enviado por el cliente, para que solo `JwtAuth` pueda ponerlo.
- `security/JwtService`: verificación de firma HS256 y de los claims `exp`, `iss` (debe ser `JWT_ISSUER`) y `sub` (que debe ser un UUID). Si `JWT_SECRET` falta o tiene menos de 32 bytes, la aplicación no arranca.

## Rutas configuradas

| Ruta pública | Reenvía a | Filtros |
| --- | --- | --- |
| `/api/auth/**` | `AUTH_SERVICE_URL` | `StripPrefix=1` (sin JWT: aquí es donde se obtiene el token) |
| `GET /api/messages/nearby` | `MESSAGES_SERVICE_URL` | `StripPrefix=1` (pública, sin JWT) |
| `/api/messages/**` (resto) | `MESSAGES_SERVICE_URL` | `StripPrefix=1`, `JwtAuth` |
| `/api/network/graphql` | `NETWORK_SERVICE_URL` | `StripPrefix=2`, `JwtAuth` (→ `/graphql`; el servicio de red social solo expone GraphQL) |
| `GET /api/profiles/avatars/**` | `PROFILE_SERVICE_URL` | `StripPrefix=1` (pública: las etiquetas `<img>` no envían el JWT) |
| `/api/profiles/**` (resto) | `PROFILE_SERVICE_URL` | `StripPrefix=1`, `JwtAuth` |
| `/api/ratings/**` | `RATING_SERVICE_URL` | `StripPrefix=1`, `JwtAuth` (→ `/ratings/**`) |
| `/api/reputation/**` | `REPUTATION_SERVICE_URL` | `StripPrefix=1`, `JwtAuth` (→ `/reputation/**`) |
| `POST /api/socket/tickets` | `SOCKET_GATEWAY_HTTP_URL` | `StripPrefix=2`, `JwtAuth` (→ `/tickets`) |
| `GET /api/ws` y `/api/ws/**` | `SOCKET_GATEWAY_WS_URL` | `StripPrefix=1` (sin JWT: el ticket viaja en `?ticket=...`) |

Las rutas se evalúan en orden: por eso las reglas específicas de `nearby`, avatares y tickets están antes que las reglas generales que exigen JWT.

Además, `GET /actuator/health` expone el estado del gateway (lo usa el healthcheck de Docker).

## Variables de entorno

Copia `.example.env` a `.env` y ajusta:

| Variable | Obligatoria | Valor por defecto | Descripción |
| --- | --- | --- | --- |
| `JWT_SECRET` | Sí | Sin valor | Secreto HS256 compartido con el microservicio de autenticación. Mínimo 32 bytes; sin él la aplicación no arranca. |
| `JWT_ISSUER` | No | `geopicto-auth` | Valor exigido en el claim `iss`. Debe coincidir con el del servicio de autenticación. |
| `AUTH_SERVICE_URL` | No | `http://localhost:8101` | URL interna del microservicio de autenticación. |
| `MESSAGES_SERVICE_URL` | No | `http://localhost:8100` | URL interna del microservicio de mensajes. |
| `NETWORK_SERVICE_URL` | No | `http://localhost:8001` | URL interna del microservicio de red social. |
| `PROFILE_SERVICE_URL` | No | `http://localhost:8300` | URL interna del microservicio de perfiles. |
| `RATING_SERVICE_URL` | No | `http://localhost:8102` | URL interna del microservicio de calificaciones. |
| `REPUTATION_SERVICE_URL` | No | `http://localhost:8600` | URL interna del microservicio de reputación. |
| `SOCKET_GATEWAY_HTTP_URL` | No | `http://localhost:8700` | URL interna para emitir tickets de WebSocket. |
| `SOCKET_GATEWAY_WS_URL` | No | `ws://localhost:8700` | URL interna del WebSocket. |
| `CORS_ALLOWED_ORIGINS` | No | `http://localhost:8081,http://localhost:8082` | Orígenes del frontend autorizados, separados por comas. |

## Ejecución local

```bash
JWT_SECRET=$(openssl rand -base64 48) mvn spring-boot:run
```

El gateway queda publicado en `http://localhost:8080` y apunta por defecto a los puertos publicados de cada servicio (`8100` para mensajes).

## Pruebas

```bash
mvn test
```

Las pruebas levantan el gateway contra un backend simulado (MockWebServer) y cubren el enrutamiento, el filtro `JwtAuth` (token válido, ausente, expirado, mal firmado, de otro emisor, sin `iss`, sin `sub` o sin `exp`), la eliminación de `X-User-ID` falsificados, CORS y el endpoint de salud.

## Ejecución con Docker Compose

Para levantar el sistema completo (gateway, mensajes, base de datos y frontend en una misma red), usa el `docker-compose.yml` de la raíz del repositorio; ver el [README principal](../README.md).

El `docker-compose.yml` de esta carpeta levanta solo el gateway, útil para probar la imagen:

```bash
cp .example.env .env
docker compose up --build
```

## Pendientes conocidos

- El gateway valida los tokens sin consultar al servicio de autenticación, así que un token sigue sirviendo hasta que expira (15 minutos) aunque el usuario cierre sesión. Ver [`docs/jwt-contract.md`](../docs/jwt-contract.md).
- El contrato documentado en `frontend/mobile/API_GATEWAY_INTEGRATION.md` no coincide del todo con lo que implementa hoy `services/messages` (payload de creación de mensaje, filtros de `status`, endpoint de cambio de estado). Este gateway solo enruta y traduce autenticación; no intenta resolver esas discrepancias de contrato.
