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

Las rutas protegidas exigen `Authorization: Bearer <token>`. El middleware del servicio valida el JWT por su cuenta (firma HS256, `iss`, `exp` y `sub` UUID) y deja el usuario en `request.state.user_id`; no confía en `X-User-ID`. El gateway reenvía `Authorization` y además agrega `X-User-ID` para los servicios que aún lo usan.

`GET /` (salud) y el preflight CORS son públicos. GraphiQL (`GET /graphql` con `Accept: text/html`) es público para cargar la interfaz, pero las consultas y mutaciones GraphQL exigen JWT. Desde el frontend se accede por `/api/network/graphql`, y el gateway lo reenvía a `/graphql`.

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

Como es habitual en GraphQL, esas respuestas tienen HTTP `200`. Solo la falta de un JWT válido responde `401` con `{ "message": "..." }`.

## Eventos de actividad

Si `RABBITMQ_URL` está definido, el servicio publica `activity.created.v1` después de persistir cada mutación de solicitud:

- `sendFriendRequest` → `FRIEND_REQUEST_SENT` (notifica al destinatario).
- `acceptFriendRequest` → `FRIEND_REQUEST_ACCEPTED` (notifica a quien envió la solicitud).
- `rejectFriendRequest` → `FRIEND_REQUEST_REJECTED` (notifica a quien envió la solicitud).

El evento usa el sobre habitual (`eventId`, `eventType`, `version`, `occurredAt`, `producer`, `correlationId`, `payload`) y `socket-gateway` lo consume desde `socket.events.q`. Si RabbitMQ falla, la mutación GraphQL no falla: se registra el error. No hay outbox ni colección de eventos procesados.

## Ejecución

En el sistema completo se levanta desde el `docker-compose.yml` de la raíz (ver el [README principal](../../README.md)).

Para trabajar solo en este servicio, crea `.env` a partir de `.env.example` y ejecuta:

```bash
docker compose up --build
```

El Compose local levanta MongoDB y RabbitMQ. Variables principales:

| Variable | Obligatoria | Valor por defecto | Descripción |
| --- | --- | --- | --- |
| `MONGO_HOST` | Sí | Sin valor | Host de MongoDB. |
| `MONGO_DB` | Sí | Sin valor | Base de datos. |
| `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD` | Sí | Sin valor | Credenciales de MongoDB. |
| `JWT_SECRET` | Sí | Sin valor | Secreto HS256 compartido con `auth` y el gateway (mínimo 32 bytes). |
| `JWT_ISSUER` | No | `geopicto-auth` | Emisor exigido en `iss`. |
| `RABBITMQ_URL` | No | Vacío | Si está vacío, `activity.created.v1` queda deshabilitado. |
| `RABBITMQ_EXCHANGE` | No | `geopicto.events` | Exchange topic de eventos. |
| `CORS_ORIGINS` | No | Vacío | Vacío detrás del gateway. |

GraphiQL queda en `http://localhost:8001/graphql`. Para ejecutar consultas necesita el header `Authorization: Bearer <token>`; puedes obtener uno con `node scripts/dev-token.mjs <uuid>` desde la raíz del repositorio.
