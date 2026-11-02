# Servicio de perfiles

## Propósito

Este componente gestiona los datos públicos de cada usuario de GeoPicto: el nombre visible, la descripción, la foto de perfil (avatar) y el color de autor. También resuelve varios perfiles en una sola petición para mostrarlos junto a mensajes, amigos y rankings. Está escrito en **Python (FastAPI)**, guarda los datos en **PostgreSQL** y las imágenes en **MinIO** (almacenamiento compatible con S3).

La identidad sigue en `auth`: registro, login, contraseña, email y sesiones. Este servicio nunca guarda el email ni la contraseña, y no permite cambiar el `username`; solo conserva una copia para mostrarla.

El código usa las mismas capas que `auth`:

- `app/main.py`: crea la aplicación y arranca el consumidor de eventos. También expone `/health`.
- `app/handler`: rutas HTTP, dependencias (sesión de BD, usuario del JWT) y formato de errores.
- `app/service`: reglas de negocio (`profile_service.py`) y procesamiento de imágenes (`images.py`).
- `app/repository`: consultas a la base de datos.
- `app/domain`: modelo `Profile` (SQLAlchemy).
- `app/schema`: contratos de entrada y salida (Pydantic, en camelCase para el frontend).
- `app/storage`: acceso a MinIO.
- `app/messaging`: conexión a RabbitMQ, consumidor de eventos de `auth` y publicación de `profile.updated.v1`.
- `app/core`: configuración, validación del JWT, color por defecto y límite de subidas.
- `migrations`: esquema versionado con Alembic.
- `tests`: pruebas de la API, de las imágenes y de los eventos (pytest).

## API

El gateway publica estas rutas bajo `/api/profiles`. A diferencia de `auth`, las respuestas exitosas **devuelven el dato directamente**, sin el sobre `{ success, data }`.

| Método y ruta | Autenticación | Respuesta |
| --- | --- | --- |
| `GET /profiles/me` | JWT | Perfil propio. Si aún no existe, lo crea. |
| `PATCH /profiles/me` | JWT | Perfil actualizado. Cuerpo JSON con `displayName?`, `about?` y `color?`. |
| `POST /profiles/me/avatar` | JWT | `{ "avatarUrl": "..." }`. `multipart/form-data` con el campo `file`. |
| `DELETE /profiles/me/avatar` | JWT | `204 No Content`. |
| `GET /profiles/{userId}` | JWT | Perfil de otro usuario, o `404` si no existe. |
| `GET /profiles/batch?ids=uuid,uuid` | JWT | Lista con los perfiles que existen, en el orden pedido. Máximo 100 ids. |
| `GET /profiles/search?q=&limit=` | JWT | Busca por nombre visible o username, sin distinguir mayúsculas. `limit` entre 1 y 50 (20 por defecto). |
| `GET /profiles/avatars/{key}` | Pública | La imagen WebP. Las etiquetas `<img>` no pueden enviar el JWT. |
| `GET /health` | — | Estado del servicio, de la BD y de MinIO. Responde `503` si alguno falla. |

Ejemplo de perfil:

```json
{
  "userId": "7b8339ec-2e38-47b3-9d3b-7643652f1fc7",
  "username": "ExploradorGeo",
  "displayName": "Explorador",
  "about": "Cazando pictos por Bogotá.",
  "avatarUrl": "http://localhost:8080/api/profiles/avatars/avatars/7b8339ec-2e38-47b3-9d3b-7643652f1fc7/3f9c0e6b2a4d4c1e9b7a5d8f6e2c1a0b.webp",
  "color": "#2AC769",
  "createdAt": "2026-10-12T00:38:01Z",
  "updatedAt": "2026-10-24T14:30:00Z"
}
```

Los errores devuelven el código HTTP y `{ "error": "codigo", "message": "texto" }`, donde `message` está pensado para mostrarse tal cual al usuario.

| Código | HTTP | Cuándo |
| --- | --- | --- |
| `missing_token`, `invalid_token` | 401 | Falta el JWT o no es válido. |
| `profile_not_found` | 404 | `GET /profiles/{userId}` de un usuario sin perfil. |
| `avatar_not_found` | 404 | La clave del avatar no existe. |
| `avatar_too_large` | 413 | El archivo supera `AVATAR_MAX_BYTES` (5 MB). |
| `unsupported_media_type` | 415 | El archivo no es JPEG, PNG ni WebP, o es animado (GIF, SVG, APNG...). |
| `invalid_image` | 422 | El archivo está dañado, no es una imagen o mide menos de 64×64 o más de 4096×4096. |
| `validation_error` | 422 | Hay campos inválidos. Incluye `details` con el detalle de cada campo. |
| `rate_limited` | 429 | Se superaron las subidas de avatar permitidas por hora. Incluye el header `Retry-After`. |
| `storage_unavailable` | 503 | MinIO no responde. |

### Reglas

- `displayName`: de 1 a 50 caracteres después de quitar los espacios de los extremos, sin caracteres de control. `null` lo borra, y entonces el frontend muestra el `username`.
- `about`: máximo 500 caracteres de texto plano; se permiten saltos de línea. `null` o `""` lo borran.
- `color`: `#RRGGBB`, se guarda en mayúsculas. `null` vuelve al color por defecto. Ese color se elige de la paleta que usaba `auth` a partir de un hash del `userId`, así que siempre es el mismo para el mismo usuario.
- El `PATCH` es parcial: solo cambia los campos que vienen en el cuerpo. Enviar `username` o `email` responde `422`.
- El usuario se toma del claim `sub` del JWT, que el servicio vuelve a validar por su cuenta. El header `X-User-ID` se ignora, igual que en `messages` y `network` (ver [`docs/jwt-contract.md`](../../docs/jwt-contract.md)).

### Avatares

1. El formato se valida abriendo la imagen con Pillow; el `Content-Type` que envía el cliente no se tiene en cuenta.
2. Se corrige la orientación EXIF, se recorta un cuadrado centrado, se redimensiona a 512×512 y se convierte a WebP con calidad 85. El archivo resultante no conserva metadatos (EXIF, ICC, XMP).
3. Se guarda en el bucket privado `geopicto-avatars` como `avatars/<userId>/<uuid>.webp`. El avatar anterior se borra solo cuando el nuevo ya quedó guardado en la base de datos.
4. Como cada versión tiene una URL distinta, se sirve con `Cache-Control: public, max-age=31536000, immutable`.
5. Cada usuario puede subir hasta `AVATAR_UPLOADS_PER_HOUR` avatares por hora (10 por defecto). El contador vive en memoria, así que funciona con una sola réplica del servicio.

## Modelo de datos

Una sola tabla, `profiles`:

| Columna | Contenido |
| --- | --- |
| `user_id` | UUID del usuario en `auth` (clave primaria). |
| `username` | Copia del username de `auth`, actualizada con `user.updated.v1`. |
| `display_name`, `about` | Datos editables. |
| `color` | Color de autor `#RRGGBB`. |
| `avatar_key`, `avatar_url` | Ruta del objeto en MinIO y URL pública estable. |
| `created_at`, `updated_at` | Marcas de tiempo. |

Hay índices sobre `lower(display_name)` y `lower(username)` para las búsquedas. No hay tablas de outbox ni de eventos procesados.

## Eventos

Usan el exchange `topic` `geopicto.events` y el sobre común de eventos (`eventId`, `eventType`, `occurredAt`, `producer`, `payload`...).

| Cola | Evento | Efecto |
| --- | --- | --- |
| `profile.user.registered.q` | `user.registered.v1` | Crea el perfil con `displayName = username` y el color por defecto. |
| `profile.user.updated.q` | `user.updated.v1` | Actualiza la copia del `username`. Si el `displayName` seguía siendo igual al username anterior, también lo actualiza. |
| `profile.user.deleted.q` | `user.deleted.v1` | Borra el perfil y su avatar. |

Todos los manejadores son idempotentes por `user_id`: una entrega repetida no tiene efecto. Si un mensaje está mal formado, se descarta. Si la falla es temporal (por ejemplo, la BD está caída), el mensaje vuelve a la cola.

Al cambiar `displayName`, `about`, `color` o el avatar, el servicio publica `profile.updated.v1`:

```json
{
  "userId": "7b8339ec-...",
  "changedFields": ["displayName", "avatarUrl"],
  "displayName": "Explorador",
  "avatarUrl": "http://localhost:8080/api/profiles/avatars/...",
  "color": "#2AC769",
  "updatedAt": "2026-10-24T14:30:00Z"
}
```

Si RabbitMQ no está disponible, el servicio sigue funcionando:
- **Consumidor**: reintenta la conexión cada 5 s.
- **Publicación**: si falla, se registra en el log y el cambio queda guardado igual.
- **Perfiles nuevos**: se crean en el primer `GET /profiles/me`. Esa misma creación perezosa sirve de backfill para los usuarios que se registraron antes de que existiera este servicio.

## Ejecución con Docker Compose

Desde este directorio:

```powershell
Copy-Item .example.env .env   # y define JWT_SECRET
docker compose up --build
```

Esto levanta el servicio con su base de datos, MinIO y RabbitMQ:
- API: `http://localhost:8300`, con Swagger en `/docs`.
- Consola de MinIO: `http://localhost:9001`.
- Consola de RabbitMQ: `http://localhost:15672`.

El contenedor aplica las migraciones al iniciar y crea el bucket si no existe. En el sistema completo (`docker compose up` desde la raíz), el servicio solo se alcanza a través del gateway.

| Variable | Obligatoria | Valor por defecto | Descripción |
| --- | --- | --- | --- |
| `DATABASE_URL` | Sí | — | Cadena de conexión PostgreSQL. |
| `JWT_SECRET` | Sí | — | El mismo secreto de `auth` y del gateway (mínimo 32 caracteres). |
| `JWT_ISSUER` | No | `geopicto-auth` | Valor exigido en el claim `iss`. |
| `JWT_LEEWAY_SECONDS` | No | `10` | Tolerancia de reloj al validar `exp`. |
| `PORT` | No | `8000` | Puerto HTTP dentro del contenedor. |
| `CORS_ORIGINS` | No | vacío | Vacío detrás del gateway, que es quien agrega CORS. |
| `RABBITMQ_URL` | No | vacío | Broker. Si está vacío, no se consumen ni publican eventos. |
| `RABBITMQ_EXCHANGE` | No | `geopicto.events` | Exchange de eventos. |
| `MINIO_ENDPOINT` | No | vacío | `host:puerto` de MinIO. Si está vacío, las rutas de avatar responden `503`. |
| `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | Con MinIO | vacío | Credenciales de MinIO. |
| `MINIO_SECURE` | No | `false` | Usa HTTPS para hablar con MinIO. |
| `MINIO_BUCKET` | No | `geopicto-avatars` | Bucket de los avatares. |
| `AVATAR_PUBLIC_BASE_URL` | No | `http://localhost:8080/api/profiles/avatars` | Prefijo de la `avatarUrl` que recibe el cliente. |
| `AVATAR_MAX_BYTES` | No | `5242880` | Tamaño máximo de subida. |
| `AVATAR_UPLOADS_PER_HOUR` | No | `10` | Subidas permitidas por usuario por hora. |

## Pruebas

```bash
uv sync --group dev
uv run pytest
```

Las pruebas usan SQLite y un almacenamiento en memoria en lugar de MinIO, así que no necesitan Docker.

## Probar con el sistema completo

```bash
TOKEN=$(curl -s -X POST localhost:8080/api/auth/register -H "Content-Type: application/json" -d '{"username":"ExploradorGeo","email":"explorador@geochat.org","password":"secreto123"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')

curl localhost:8080/api/profiles/me -H "Authorization: Bearer $TOKEN"
curl -X PATCH localhost:8080/api/profiles/me -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"displayName":"Explorador","about":"Cazando pictos por Bogotá."}'
curl -X POST localhost:8080/api/profiles/me/avatar -H "Authorization: Bearer $TOKEN" -F "file=@foto.jpg"
```
