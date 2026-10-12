# Servicio de red social

## Propósito y estado

Este componente gestiona las relaciones entre usuarios de GeoPicto: solicitudes de amistad (enviar, aceptar, rechazar, cancelar) y la lista de amigos. Está escrito en **Python (FastAPI)** y guarda los datos en **MongoDB**, la base de datos NoSQL del sistema.

Su interfaz es una **API GraphQL** (`/graphql`, con [Strawberry](https://strawberry.rocks/)). Se eligió GraphQL porque la pantalla de amigos necesita combinar varios datos (amigos, solicitudes recibidas y enviadas) y con GraphQL los obtiene en una sola petición, pidiendo solo los campos que usa.

El código se organiza en capas:

- `app/main.py`: crea la aplicación, CORS opcional, manejador de errores HTTP y el endpoint `/graphql`.
- `app/gql`: esquema GraphQL (tipos, consultas y mutaciones). Los resolvers delegan en los servicios.
- `app/services`: reglas de negocio de solicitudes y amistades.
- `app/repositories`: acceso a la colección `friendships` de MongoDB.
- `app/models`: entidad de dominio.
- `app/core`: configuración, conexión a MongoDB, dependencias y errores.

Cada documento de `friendships` guarda la pareja de usuarios (`user_a`, `user_b`, ordenados), el `status` (`pending` o `accepted`), quién envió la solicitud (`requested_by`) y las fechas. Un índice único sobre la pareja impide relaciones duplicadas.

## Identidad del usuario

Igual que el servicio de mensajes, este servicio no valida tokens: confía en el encabezado **`X-User-ID`** (UUID) que agrega el API Gateway después de verificar el JWT. Desde el frontend se accede por `/api/network/graphql`, y el gateway lo reenvía a `/graphql`.

Con `APP_ENV=development` y sin `X-User-ID`, se usa `DEV_USER_ID` para poder probar el servicio solo. Con cualquier otro valor de `APP_ENV`, `X-User-ID` es obligatorio (`401` si falta).

## API GraphQL

| Ruta | Descripción |
| --- | --- |
| `POST /graphql` | Consultas y mutaciones. En el gateway: `POST /api/network/graphql` con `Authorization: Bearer <token>`. |
| `GET /graphql` | GraphiQL: editor en el navegador con autocompletado y la documentación del esquema. Úsalo directamente contra el servicio (`http://localhost:8001/graphql` al correrlo solo). |
| `GET /` | Salud del servicio. |

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

Las listas aceptan `limit` (1–100, por defecto 20) y `cursor` (el `id` del último elemento recibido) para paginar.

Ejemplo: toda la pantalla de amigos en una sola petición a través del gateway.

```bash
curl -X POST localhost:8080/api/network/graphql \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"{ friends { otherUserId } incomingRequests { id otherUserId } outgoingRequests { id otherUserId } }"}'
```

Enviar una solicitud de amistad:

```bash
curl -X POST localhost:8080/api/network/graphql \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"mutation($id: UUID!) { sendFriendRequest(recipientId: $id) { id status } }","variables":{"id":"<uuid-del-otro-usuario>"}}'
```

### Errores

Los errores de negocio llegan en `errors[].message` (en español) con un código en `errors[].extensions.code`:

| Código | Cuándo |
| --- | --- |
| `BAD_REQUEST` | Operación inválida: solicitud a uno mismo, solicitud que ya no está pendiente, `limit` fuera de rango, cursor inválido. |
| `FORBIDDEN` | El usuario no pertenece a la solicitud, o intenta aceptar o rechazar su propia solicitud. |
| `NOT_FOUND` | La solicitud no existe, o el usuario no está en la lista de amigos. |
| `CONFLICT` | Ya existe una relación o solicitud entre los dos usuarios. |

Como es habitual en GraphQL, esas respuestas tienen HTTP `200`. Solo la falta de `X-User-ID` (o de token, en el gateway) responde `401` con `{ "message": "..." }`.

## Ejecución

En el sistema completo se levanta desde el `docker-compose.yml` de la raíz (ver el [README principal](../../README.md)).

Para trabajar solo en este servicio, crea `.env` a partir de `.env.example` y ejecuta:

```bash
docker compose up --build
```

GraphiQL queda en `http://localhost:8001/graphql`. Para actuar como un usuario concreto, agrega en la pestaña *Headers* de GraphiQL `{ "X-User-ID": "<uuid>" }`.
