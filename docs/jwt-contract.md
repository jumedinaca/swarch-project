# Contrato JWT

Este documento define el token que emite el servicio de autenticación y que valida el API Gateway. Mientras el servicio de autenticación no exista, `scripts/dev-token.mjs` genera tokens con este mismo formato para pruebas locales.

## Formato

| Elemento | Valor |
| --- | --- |
| Algoritmo | `HS256` (HMAC-SHA256) |
| Secreto | Variable `JWT_SECRET`, compartida entre el gateway y el servicio de autenticación. Mínimo 32 bytes. |
| `sub` | **Obligatorio.** UUID del usuario. Es el valor que el gateway reenvía como `X-User-ID`. |
| `exp` | **Obligatorio.** Fecha de expiración (segundos desde epoch). |
| `iat` | Recomendado. Fecha de emisión. |

El gateway rechaza con `401` cualquier token con firma inválida, expirado, sin `exp`, sin `sub` o cuyo `sub` no sea un UUID.

Ejemplo de payload:

```json
{
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "iat": 1791763200,
  "exp": 1791849600
}
```

## Cómo viaja el token

1. El cliente envía `Authorization: Bearer <token>` al gateway.
2. En las rutas protegidas, el gateway valida el token, elimina el header `Authorization` y agrega `X-User-ID: <sub>`.
3. Los servicios internos confían en `X-User-ID` y no validan el token. Por eso el gateway elimina cualquier `X-User-ID` que envíe el cliente, en todas las rutas.

## Rutas

| Ruta pública | Autenticación | Destino interno |
| --- | --- | --- |
| `/api/auth/**` | Pública | `auth:/…` (sin el prefijo `/api`) |
| `GET /api/messages/nearby?lat=&lng=&radius=` | Pública | `messages:/messages/nearby` |
| `/api/messages/**` (resto) | JWT | `messages:/messages/…` |

## Para el servicio de autenticación

- Exponer sus rutas sin el prefijo `/api`: el gateway lo retira, así que `/api/auth/login` llega como `/auth/login`.
- Firmar con el mismo `JWT_SECRET` y usar el UUID del usuario como `sub`.
- Agregarse al `docker-compose.yml` de la raíz como servicio `auth` escuchando en el puerto `8080`; el gateway ya apunta a `http://auth:8080`.

## Token de desarrollo

```bash
node scripts/dev-token.mjs 550e8400-e29b-41d4-a716-446655440000
```

Lee `JWT_SECRET` del entorno o del `.env` de la raíz. Sin UUID, genera uno aleatorio. `--hours N` cambia la duración (24 h por defecto).
