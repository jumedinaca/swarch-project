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
| `sid`, `username`, `type`, `jti` | Los agrega el servicio de autenticación para su propio uso (sesión, nombre, tipo de token, id único). El gateway no los usa. |

El gateway rechaza con `401` cualquier token con firma inválida, expirado, sin `exp`, con un `iss` distinto, sin `sub` o cuyo `sub` no sea un UUID.

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

1. El cliente obtiene el token con `POST /api/auth/login` o `POST /api/auth/register`.
2. En cada petición envía `Authorization: Bearer <token>` al gateway.
3. En las rutas protegidas, el gateway valida el token por su cuenta (sin llamar al servicio de autenticación), elimina el header `Authorization` y agrega `X-User-ID: <sub>`.
4. Los servicios internos confían en `X-User-ID` y no validan el token. Por eso el gateway elimina cualquier `X-User-ID` que envíe el cliente, en todas las rutas.

## Logout y expiración

Como el gateway no consulta las sesiones, un access token sigue sirviendo en las rutas protegidas hasta que expira, aunque el usuario haya cerrado sesión. Por eso dura solo 15 minutos. El frontend lo renueva automáticamente con `POST /api/auth/refresh` y su refresh token cuando una petición responde `401`; esa llamada sí falla de inmediato si la sesión fue revocada, y entonces la app vuelve a la pantalla de login.

## Rutas

| Ruta pública | Autenticación | Destino interno |
| --- | --- | --- |
| `/api/auth/**` | Pública | `auth:/auth/…` (sin el prefijo `/api`) |
| `GET /api/messages/nearby?lat=&lng=&radius=` | Pública | `messages:/messages/nearby` |
| `/api/messages/**` (resto) | JWT | `messages:/messages/…` |
| `POST /api/network/graphql` | JWT | `network:/graphql` |

## Token de desarrollo

Para probar sin pasar por el registro:

```bash
node scripts/dev-token.mjs 550e8400-e29b-41d4-a716-446655440000
```

Lee `JWT_SECRET` del entorno o del `.env` de la raíz; si no está definido, usa el mismo valor por defecto que `docker-compose.yml`. Sin UUID, genera uno aleatorio. `--hours N` cambia la duración (24 h por defecto).
