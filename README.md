# GeoPicto

Aplicación para publicar mensajes asociados a una ubicación y consultar los que están cerca.

## Componentes

| Carpeta | Descripción | Tecnología |
| --- | --- | --- |
| [`frontend/`](frontend/) | App móvil y web | Expo / React Native |
| [`gateway/`](gateway/README.md) | Punto único de entrada: enruta, valida JWT y agrega `X-User-ID` | Java, Spring Cloud Gateway |
| [`services/messages/`](services/messages/README.md) | Mensajes geolocalizados y búsqueda por proximidad | Go, PostgreSQL + PostGIS |
| `services/auth/` | Autenticación y emisión de JWT (pendiente) | — |

El formato de los tokens y el enrutamiento están en [`docs/jwt-contract.md`](docs/jwt-contract.md).

## Ejecutar todo el sistema

Requiere Docker con Compose.

```bash
cp .env.example .env
```

Define `JWT_SECRET` en `.env` (mínimo 32 bytes; por ejemplo, el resultado de `openssl rand -base64 48`) y luego:

```bash
docker compose up --build
```

| Servicio | URL |
| --- | --- |
| Frontend web | http://localhost:8081 |
| API Gateway | http://localhost:8080 |
| Salud del gateway | http://localhost:8080/actuator/health |

El servicio de mensajes y su base de datos no se publican al host: solo se accede a ellos a través del gateway.

El frontend sigue usando datos simulados (`EXPO_PUBLIC_USE_MOCK_DATA=true`) hasta que adopte el contrato real del servicio de mensajes.

## Probar la API

Mientras no exista el servicio de autenticación, genera un token de desarrollo (requiere Node):

```bash
TOKEN=$(node scripts/dev-token.mjs 550e8400-e29b-41d4-a716-446655440000)
```

Crear un mensaje:

```bash
curl -X POST localhost:8080/api/messages -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"content":"Hola desde la Plaza Che","latitude":4.6371,"longitude":-74.0834}'
```

Buscar mensajes cercanos (no requiere token):

```bash
curl "localhost:8080/api/messages/nearby?lat=4.6371&lng=-74.0834&radius=500"
```

## Trabajar en un solo componente

Cada componente conserva su propio `docker-compose.yml` y README con instrucciones para ejecutarlo de forma aislada.
