# Contrato JWT

Este documento define el access token que emite el servicio de autenticación (`services/auth`) y que valida el API Gateway. `scripts/dev-token.mjs` genera tokens con este mismo formato para pruebas locales.

## Formato

| Elemento | Valor |
| --- | --- |
| Algoritmo | `HS256` (HMAC-SHA256) |
| Secreto | Variable `JWT_SECRET`, compartida entre el gateway y el servicio de autenticación. Mínimo 32 bytes. Si no se define, `docker-compose.yml` usa un valor por defecto pensado solo para ejecutar el prototipo en local. |
| `sub` | **Obligatorio.** UUID del usuario. Es el valor que el gateway reenvía como `X-User-ID`. |
| `iss` | **Obligatorio.** `geopicto-auth` (configurable con `JWT_ISSUER` en ambos servicios). |
| `exp` | **Obligatorio.** Fecha de expiración (segundos desde epoch). El servicio de autenticación emite tokens de 15 minutos. |
| `iat` | Fecha de emisión. |
| `sid` | UUID de la sesión en `auth-db`. El servicio de autenticación lo registra en la blacklist distribuida de Redis (`auth:revoked:sid:<sid>`) al revocar la sesión, y el gateway lo verifica en cada petición protegida (Escenario 5). |
| `jti` | Identificador único del token. Si está presente, el gateway también consulta `auth:revoked:jti:<jti>` en Redis. |
| `username`, `type` | Metadatos agregados por el servicio de autenticación para uso interno. El gateway no los requiere para autorizar. |

El gateway rechaza con `401` cualquier token con firma inválida, expirado, sin `exp`, con un `iss` distinto, sin `sub`, cuyo `sub` no sea un UUID, o cuyo `sid`/`jti` figure en la blacklist de Redis.

Ejemplo de payload:

```json
{
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "sid": "701e9fda-aaee-46e1-a43b-f3b3b2914010",
  "username": "ExploradorGeo",
  "type": "access",
  "iss": "geopicto-auth",
  "iat": 1791763200,
  "exp": 1791764100,
  "jti": "e303938ca9b44fa59fc90b5d92e17907"
}
```

## Cómo viaja el token

1. El cliente obtiene el token con `POST /api/auth/login` o `POST /api/auth/register` (a través del reverse proxy `https://localhost`).
2. En cada petición envía `Authorization: Bearer <token>` al gateway (en `profile-web`, el servidor SSR lo lee de una cookie `HttpOnly; Secure` y lo reenvía al gateway).
3. En las rutas protegidas, el gateway valida la firma HS256 y los claims, consulta la blacklist de revocación en Redis DB 1 (`auth:revoked:sid:<sid>` y, si aplica, `auth:revoked:jti:<jti>`), conserva el header `Authorization` y agrega `X-User-ID: <sub>`.
4. `messages`, `network` y `profile` vuelven a validar localmente la firma, `iss` y `exp` del JWT por su cuenta (defensa en profundidad) y usan el `sub` como identidad; no confían en `X-User-ID` (la revocación distribuida contra Redis se centraliza en el gateway y en PostgreSQL dentro de `auth`). `rating` y `reputation` no revalidan el token: confían en el `X-User-ID` que agrega el gateway. `socket-gateway` autentica el WebSocket con un ticket efímero obtenido en `POST /api/socket/tickets`. Por eso el gateway elimina cualquier `X-User-ID` y `X-Internal-Token` que envíe el cliente, en todas las rutas (y `reverse-proxy` también descarta `X-Internal-Token` en el borde).

## Logout, revocación y expiración

En Prototipo 3, los access tokens siguen teniendo una vida corta de 15 minutos, **pero se invalidan de inmediato al revocar la sesión** mediante el *Distributed Token Revocation / Session Blacklist Pattern* (Escenario 5):

- Al ejecutar `POST /api/auth/logout`, `POST /api/auth/logout-all`, `DELETE /api/auth/sessions/{id}`, cambio de contraseña (`PUT /api/auth/password`) o al detectar reuso de un refresh token ya rotado, `services/auth` marca la sesión como revocada en PostgreSQL y escribe `auth:revoked:sid:<sid>` en Redis DB 1 con un TTL igual al tiempo de vida restante del access token (máximo 15 minutos).
- El gateway consulta Redis en cada ruta protegida (`TOKEN_BLACKLIST_ENABLED=true`) y responde `401 Unauthorized` de forma inmediata (`< 1 s`) si la sesión fue revocada. Si Redis no responde (`500 ms` timeout), el modo por defecto (`TOKEN_BLACKLIST_FAIL_OPEN=true`) prioriza disponibilidad degradando temporalmente a la expiración de 15 minutos, mientras que `TOKEN_BLACKLIST_FAIL_OPEN=false` responde `503` priorizando seguridad.
- El frontend renueva automáticamente tokens expirados con `POST /api/auth/refresh` cuando recibe `401`; si la sesión fue revocada, el refresh falla y la app redirige al login.

## Rutas

| Ruta pública | Autenticación | Destino interno |
| --- | --- | --- |
| `/api/auth/**` | Pública | `auth:/auth/…` (sin el prefijo `/api`) |
| `GET /api/messages/nearby?lat=&lng=&radius=` | Pública | `messages:/messages/nearby` |
| `/api/messages/**` (resto) | JWT | `messages:/messages/…` |
| `POST /api/network/graphql` | JWT | `network:/graphql` |
| `GET /api/profiles/avatars/**` | Pública | `profile:/profiles/avatars/…` |
| `/api/profiles/**` (resto) | JWT | `profile:/profiles/…` |
| `/api/ratings/**` | JWT | `rating:/ratings/…` |
| `/api/reputation/**` | JWT | `reputation:/reputation/…` |
| `POST /api/socket/tickets` | JWT | `socket-gateway:/tickets` |
| `GET /api/ws` y `/api/ws/**` | Ticket efímero | `socket-gateway:/ws?ticket=…` |

## Token de desarrollo

Para probar sin pasar por el registro:

```bash
node scripts/dev-token.mjs 550e8400-e29b-41d4-a716-446655440000
```

Lee `JWT_SECRET` y `JWT_ISSUER` del entorno o del `.env` de la raíz; si no están definidos, usa los mismos valores por defecto que `docker-compose.yml`. Sin UUID, genera uno aleatorio. `--hours N` cambia la duración (24 h por defecto).
