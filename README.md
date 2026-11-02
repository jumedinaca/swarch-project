# GeoPicto

Aplicación para publicar mensajes asociados a una ubicación y consultar los que están cerca.

## Componentes

| Carpeta | Descripción | Tecnología |
| --- | --- | --- |
| [`frontend/`](frontend/) | App móvil y web | Expo / React Native |
| [`gateway/`](gateway/README.md) | Punto único de entrada: enruta, valida JWT y agrega `X-User-ID` | Java, Spring Cloud Gateway |
| [`services/messages/`](services/messages/README.md) | Mensajes geolocalizados y búsqueda por proximidad | Go, PostgreSQL + PostGIS |
| [`services/auth/`](services/auth/README.md) | Registro, login, sesiones y emisión de JWT | Python (FastAPI), PostgreSQL |
| [`services/network/`](services/network/README.md) | Solicitudes de amistad y lista de amigos (API GraphQL) | Python (FastAPI, Strawberry), MongoDB |
| [`services/profile/`](services/profile/README.md) | Nombre visible, descripción, avatar y color de autor | Python (FastAPI), PostgreSQL, MinIO |

Los servicios se comunican por eventos a través de RabbitMQ: por ejemplo, `auth` publica `user.registered.v1` y `profile` crea el perfil del nuevo usuario.

El formato de los tokens y el enrutamiento están en [`docs/jwt-contract.md`](docs/jwt-contract.md).

## Ejecutar todo el sistema

Requiere Docker con Compose. No hace falta ninguna configuración previa:

```bash
git clone https://github.com/jumedinaca/swarch-project.git
cd swarch-project
docker compose up --build
```

El secreto con el que se firman los JWT (`JWT_SECRET`) tiene un valor por defecto en el `docker-compose.yml`, pensado solo para ejecutar el prototipo en local. Para usar uno propio, copia `.env.example` a `.env` y define `JWT_SECRET` (mínimo 32 bytes; por ejemplo, el resultado de `openssl rand -base64 48`).

| Servicio | URL |
| --- | --- |
| Frontend web | http://localhost:8081 |
| API Gateway | http://localhost:8080 |
| Salud del gateway | http://localhost:8080/actuator/health |

Los servicios de autenticación, mensajes, red social y perfiles, sus bases de datos, RabbitMQ y MinIO no se publican al host: solo se accede a ellos a través del gateway.

El frontend usa el backend real (`EXPO_PUBLIC_USE_MOCK_DATA=false`). Con `true` usa datos simulados en el navegador, útil para trabajar solo en la interfaz. Como la variable se incrusta al compilar, después de cambiarla hay que reconstruir el frontend con `docker compose up --build frontend`.

## Verificar la integración

Con el sistema levantado, este script recorre frontend → gateway → auth / mensajes / red social con dos usuarios nuevos y valida cada paso (requiere Node):

```bash
node scripts/smoke-test.mjs
```

## Probar la API

Registra un usuario y guarda su token (el token dura 15 minutos; el frontend lo renueva solo con el refresh token):

```bash
TOKEN=$(curl -s -X POST localhost:8080/api/auth/register -H "Content-Type: application/json" -d '{"username":"ExploradorGeo","email":"explorador@geochat.org","password":"secreto123"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
```

Si el usuario ya existe, inicia sesión en su lugar:

```bash
TOKEN=$(curl -s -X POST localhost:8080/api/auth/login -H "Content-Type: application/json" -d '{"usernameOrEmail":"ExploradorGeo","password":"secreto123"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
```

Para pruebas sin registrar usuarios, `node scripts/dev-token.mjs <uuid>` genera un token de desarrollo válido (requiere Node).

Crear un mensaje:

```bash
curl -X POST localhost:8080/api/messages -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"content":"Hola desde la Plaza Che","latitude":4.6371,"longitude":-74.0834}'
```

Buscar mensajes cercanos (no requiere token):

```bash
curl "localhost:8080/api/messages/nearby?lat=4.6371&lng=-74.0834&radius=500"
```

Red social (GraphQL): enviar una solicitud de amistad a otro usuario (su UUID) y consultar amigos y solicitudes en una sola petición:

```bash
curl -X POST localhost:8080/api/network/graphql -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"query":"mutation($id: UUID!) { sendFriendRequest(recipientId: $id) { id status } }","variables":{"id":"<uuid-del-otro-usuario>"}}'
curl -X POST localhost:8080/api/network/graphql -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"query":"{ friends { otherUserId } incomingRequests { id otherUserId } }"}'
```

Perfil: consultar el propio, editarlo y subir una foto (JPEG, PNG o WebP de hasta 5 MB):

```bash
curl localhost:8080/api/profiles/me -H "Authorization: Bearer $TOKEN"
curl -X PATCH localhost:8080/api/profiles/me -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"displayName":"Explorador","about":"Cazando pictos por Bogotá."}'
curl -X POST localhost:8080/api/profiles/me/avatar -H "Authorization: Bearer $TOKEN" -F "file=@foto.jpg"
```

## Trabajar en un solo componente

Cada componente conserva su propio `docker-compose.yml` y README con instrucciones para ejecutarlo de forma aislada.
