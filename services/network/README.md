# Servicio de red social

## Propósito y estado

Este componente gestiona las relaciones entre usuarios de GeoPicto: solicitudes de amistad (enviar, aceptar, rechazar, cancelar) y la lista de amigos. Está escrito en **Python (FastAPI)** y guarda los datos en **MongoDB**, la base de datos NoSQL del sistema.

El código se organiza en capas:

- `app/main.py`: crea la aplicación, CORS opcional, manejadores de errores y rutas.
- `app/api`: rutas HTTP (`/request` y `/friends`).
- `app/services`: reglas de negocio de solicitudes y amistades.
- `app/repositories`: acceso a la colección `friendships` de MongoDB.
- `app/models` y `app/schemas`: entidad de dominio y contratos de entrada/salida.
- `app/core`: configuración, conexión a MongoDB, dependencias y errores.

Cada documento de `friendships` guarda la pareja de usuarios (`user_a`, `user_b`, ordenados), el `status` (`pending` o `accepted`), quién envió la solicitud (`requested_by`) y las fechas. Un índice único sobre la pareja impide relaciones duplicadas.

## Identidad del usuario

Igual que el servicio de mensajes, este servicio no valida tokens: confía en el encabezado **`X-User-ID`** (UUID) que agrega el API Gateway después de verificar el JWT. Desde el frontend se accede por `/api/network/*` (el gateway quita ese prefijo).

Con `APP_ENV=development` y sin `X-User-ID`, se usa `DEV_USER_ID` para poder probar el servicio solo. Con cualquier otro valor de `APP_ENV`, `X-User-ID` es obligatorio (`401` si falta).

## API HTTP

| Método y ruta (interna) | Ruta en el gateway | Descripción |
| --- | --- | --- |
| `POST /request` | `/api/network/request` | Envía una solicitud. Cuerpo `{ "recipient_id": "<uuid>" }`. Responde `201`. |
| `GET /request/outcoming` | `/api/network/request/outcoming` | Solicitudes pendientes enviadas. |
| `GET /request/incoming` | `/api/network/request/incoming` | Solicitudes pendientes recibidas. |
| `GET /request/{id}` | `/api/network/request/{id}` | Detalle de una solicitud propia. |
| `POST /request/accept/{id}` | `/api/network/request/accept/{id}` | El destinatario acepta la solicitud. |
| `DELETE /request/reject/{id}` | `/api/network/request/reject/{id}` | El destinatario rechaza la solicitud (`204`). |
| `DELETE /request/cancel/{id}` | `/api/network/request/cancel/{id}` | Quien la envió la cancela (`204`). |
| `GET /friends` | `/api/network/friends` | Lista de amigos. |
| `DELETE /friends/{friend_id}` | `/api/network/friends/{friend_id}` | Elimina una amistad (`204`). |
| `GET /` | — | Salud del servicio. |

Las listas aceptan `?limit=` (1–100, por defecto 20) y `?cursor=` (id del último elemento recibido) y responden `{ "friendships": [...] }`.

Los errores se responden como `{ "message": "..." }`: `400` operación inválida, `401` sin `X-User-ID`, `403` sin permiso sobre la solicitud, `404` no encontrada, `409` relación ya existente, `422` datos inválidos.

## Ejecución

En el sistema completo se levanta desde el `docker-compose.yml` de la raíz (ver el [README principal](../../README.md)).

Para trabajar solo en este servicio, crea `.env` a partir de `.env.example` y ejecuta:

```bash
docker compose up --build
```

La API queda en `http://localhost:8001` (documentación en `/docs`).
