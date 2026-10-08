# API Gateway

## Propósito y estado

Este componente es el punto único de entrada para el frontend: enruta las peticiones hacia los microservicios internos de autenticación (`/api/auth/*`) y mensajes (`/api/messages/*`), valida los JWT emitidos por el servicio de autenticación y los traduce al header `X-User-ID` que espera el servicio de mensajes. Está escrito en Java con Spring Cloud Gateway (reactivo, sobre WebFlux).

El código se organiza así:

- `GatewayApplication`: arranque de la aplicación Spring Boot.
- `src/main/resources/application.yml`: definición declarativa de rutas, CORS y el secreto JWT.
- `filter/JwtAuthGatewayFilterFactory`: filtro de ruta `JwtAuth` que exige `Authorization: Bearer <token>`, lo valida y lo reemplaza por `X-User-ID: <sub>` antes de reenviar la petición.
- `security/JwtService`: verificación de firma HS256 y extracción del claim `sub`.

## Rutas configuradas

| Ruta pública | Reenvía a | Filtros |
| --- | --- | --- |
| `/api/auth/**` | `AUTH_SERVICE_URL` | `StripPrefix=1` (sin JWT: aquí es donde se obtiene el token) |
| `GET /api/messages/nearby` | `MESSAGES_SERVICE_URL` | `StripPrefix=1` (pública, sin JWT) |
| `/api/messages/**` (resto) | `MESSAGES_SERVICE_URL` | `StripPrefix=1`, `JwtAuth` |

Las rutas se evalúan en orden: por eso la regla específica de `nearby` está antes que la regla general de mensajes, que exige JWT.

## Variables de entorno

Copia `.example.env` a `.env` y ajusta:

| Variable | Obligatoria | Valor por defecto | Descripción |
| --- | --- | --- | --- |
| `JWT_SECRET` | Sí en producción | secreto de desarrollo en `application.yml` | Secreto HS256 compartido con el microservicio de autenticación. Debe tener al menos 32 bytes. |
| `AUTH_SERVICE_URL` | No | `http://localhost:8101` | URL interna del microservicio de autenticación. |
| `MESSAGES_SERVICE_URL` | No | `http://localhost:8100` | URL interna del microservicio de mensajes. |

## Ejecución local

```bash
mvn spring-boot:run
```

El gateway queda publicado en `http://localhost:8080`.

## Ejecución con Docker Compose

```bash
cp .example.env .env
docker compose up --build
```

Nota: como cada componente de este repositorio tiene su propio `docker-compose.yml` y crea su propia red por defecto, para que el gateway alcance a `auth` y `messages` dentro de Docker hace falta unir los contenedores a una red compartida (por ejemplo, una red `external: true` declarada en los tres `docker-compose.yml`) o apuntar `AUTH_SERVICE_URL`/`MESSAGES_SERVICE_URL` a `host.docker.internal` con los puertos publicados. Mientras no exista esa red compartida, lo más simple es levantar el gateway con `mvn spring-boot:run` fuera de Docker, apuntando a los puertos publicados de cada servicio (`8100` para mensajes).

## Pendientes conocidos

- El microservicio de autenticación (`services/auth`) todavía no existe; las rutas `/api/auth/**` no tendrán a dónde reenviar hasta que se implemente. Esta configuración asume que, una vez construido, expondrá sus rutas bajo `/login`, `/register`, etc. (sin el prefijo `/auth`, que el gateway retira con `StripPrefix=1`), y que firmará los JWT con el mismo secreto HS256 configurado aquí, usando el id de usuario como claim `sub`.
- El contrato documentado en `frontend/API_GATEWAY_INTEGRATION.md` no coincide del todo con lo que implementa hoy `services/messages` (payload de creación de mensaje, filtros de `status`, endpoint de cambio de estado). Este gateway solo enruta y traduce autenticación; no intenta resolver esas discrepancias de contrato.
