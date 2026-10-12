# Servicio de red social

## Propósito y estado

Este componente gestiona las relaciones entre usuarios de GeoPicto: solicitudes de amistad (enviar, aceptar, rechazar, cancelar) y la lista de amigos. Está escrito en **Python (FastAPI)** y guarda los datos en **MongoDB**, la base de datos NoSQL del sistema.

Expone las mismas operaciones de dos formas: una **API REST** y una **API GraphQL** (`/graphql`, con [Strawberry](https://strawberry.rocks/)). Ambas usan los mismos servicios de negocio, así que las reglas son idénticas.

El código se organiza en capas:

- `app/main.py`: crea la aplicación, CORS opcional, manejadores de errores y rutas.
- `app/api`: rutas REST (`/request` y `/friends`).
- `app/gql`: esquema GraphQL (tipos, consultas y mutaciones) montado en `/graphql`.
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

## API GraphQL

Endpoint: `POST /graphql` (en el gateway, `POST /api/network/graphql` con `Authorization: Bearer <token>`). En `GET /graphql` está GraphiQL, un editor en el navegador con autocompletado y la documentación del esquema; úsalo directamente contra el servicio (`http://localhost:8001/graphql` al correrlo solo).

```graphql
type Query {
  me: UUID!                                                   # usuario actual
  friends(limit: Int = 20, cursor: String): [Friendship!]!
  incomingRequests(limit: Int = 20, cursor: String): [Friendship!]!
  outgoingRequests(limit: Int = 20, cursor: String): [Friendship!]!
  friendship(id: ID!): Friendship!
}

type Mutation {
  sendFriendRequest(recipientId: UUID!): Friendship!
  acceptFriendRequest(id: ID!): Friendship!
  rejectFriendRequest(id: ID!): Boolean!
  cancelFriendRequest(id: ID!): Boolean!
  removeFriend(friendId: UUID!): Boolean!
}

type Friendship {
  id: ID!
  userA: UUID!
  userB: UUID!
  status: FriendshipStatus!        # PENDING | ACCEPTED
  requestedBy: UUID!
  createdAt: DateTime!
  updatedAt: DateTime!
  otherUserId: UUID!               # el otro usuario, visto desde el actual
  sentByMe: Boolean!
}
```

La ventaja frente a REST es que el cliente pide exactamente lo que necesita y en una sola petición. Por ejemplo, toda la pantalla de amigos de una vez:

```bash
curl -X POST localhost:8080/api/network/graphql   -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json"   -d '{"query":"{ friends { otherUserId } incomingRequests { id otherUserId } outgoingRequests { id otherUserId } }"}'
```

Los errores de negocio llegan en `errors[].extensions.code`: `BAD_REQUEST`, `FORBIDDEN`, `NOT_FOUND` o `CONFLICT`, con el mismo mensaje que la API REST. Como es habitual en GraphQL, esas respuestas tienen HTTP `200`; solo la falta de `X-User-ID` (o de token en el gateway) responde `401`.

## Ejecución

En el sistema completo se levanta desde el `docker-compose.yml` de la raíz (ver el [README principal](../../README.md)).

Para trabajar solo en este servicio, crea `.env` a partir de `.env.example` y ejecuta:

```bash
docker compose up --build
```

La API queda en `http://localhost:8001`: documentación REST en `/docs` y GraphiQL en `/graphql`.
