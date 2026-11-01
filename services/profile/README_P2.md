# Profile — Requisitos Prototipo 2

> Componente pendiente. Este documento es la especificación completa para implementarlo y conectarlo al resto del sistema.
>
> **Decisión de P2:** `auth` deja de manejar `color` y datos públicos. `profile` es el dueño del nombre visible, la descripción, el avatar y el color de autor. `auth` solo conserva identidad y autenticación.

## 1. Propósito

Gestionar los datos públicos de cada usuario que no pertenecen a la autenticación: nombre visible, biografía, foto de perfil y color de autor. También resuelve perfiles en lote para mostrarlos junto a mensajes, amigos y rankings.

## 2. Alcance

**Incluye**

- [ ] Perfil público por `userId`.
- [ ] Perfil propio (`me`) con edición.
- [ ] Subida, reemplazo y eliminación de avatar.
- [ ] Color de autor (movido desde `auth`).
- [ ] Creación automática del perfil al consumir `user.registered.v1`.
- [ ] Endpoint batch para resolver varios perfiles.
- [ ] Búsqueda opcional por nombre.

**No incluye**

- Registro, login, contraseña, email o sesiones.
- Reputación.
- Mensajes o amistades.

## 3. Reglas de negocio

- [ ] `displayName` es opcional; si no existe, se muestra `username`.
- [ ] `displayName`: 1–50 caracteres después de `trim`, sin caracteres de control.
- [ ] `about`: máximo 500 caracteres, texto plano.
- [ ] `color`: `#RRGGBB`. Si el usuario no lo define, se genera de forma determinística a partir del `userId` para que sea estable.
- [ ] Solo el dueño puede editar su perfil; el usuario sale de `X-User-ID`.
- [ ] `GET /profiles/me` crea el perfil de forma perezosa si el evento de registro aún no llegó.
- [ ] `GET /profiles/{userId}` devuelve `404` si no existe.
- [ ] No se puede cambiar `username` ni `email` desde este servicio.

## 4. API HTTP

Rutas internas; el gateway las publica bajo `/api/profiles`. **Las respuestas exitosas devuelven directamente el dato, sin envolver en `{ success, data }`.**

| Método y ruta | Autenticación | Respuesta |
| --- | --- | --- |
| `GET /profiles/me` | JWT | Objeto perfil. |
| `PATCH /profiles/me` | JWT | Objeto perfil actualizado. Body: `displayName?`, `about?`, `color?`. |
| `POST /profiles/me/avatar` | JWT | Objeto `{ avatarUrl }`. `multipart/form-data`, campo `file`. |
| `DELETE /profiles/me/avatar` | JWT | `204 No Content`. |
| `GET /profiles/{userId}` | JWT | Objeto perfil. |
| `GET /profiles/batch?ids=uuid,uuid` | JWT | Array de perfiles existentes. Máximo 100. |
| `GET /profiles/avatars/{key}` | Pública | Imagen binaria. |
| `GET /profiles/search?q=&limit=` | JWT | Array de perfiles (opcional). |
| `GET /health` | — | Estado del servicio, BD y MinIO. |

Ejemplo de perfil:

```json
{
  "userId": "7b8339ec-2e38-47b3-9d3b-7643652f1fc7",
  "username": "ExploradorGeo",
  "displayName": "Explorador",
  "about": "Cazando pictos por Bogotá.",
  "avatarUrl": "http://localhost:8080/api/profiles/avatars/avatars/7b8339ec/0192f3a4.webp",
  "color": "#2AC769",
  "createdAt": "2026-10-12T00:38:01Z",
  "updatedAt": "2026-10-24T14:30:00Z"
}
```

Errores: se devuelve el código HTTP y un objeto `{ "error": "codigo", "message": "texto" }`. Códigos propios: `profile_not_found` (404), `avatar_too_large` (413), `unsupported_media_type` (415), `invalid_image` (422), `forbidden` (403), `rate_limited` (429).

## 5. Modelo de datos (PostgreSQL `profile`)

Solo tablas de lógica de negocio. **No se crean tablas de outbox ni de eventos procesados en este prototipo.**

```sql
CREATE TABLE profiles (
  user_id      UUID PRIMARY KEY,
  username     VARCHAR(50) NOT NULL,
  display_name VARCHAR(50),
  about        VARCHAR(500),
  color        VARCHAR(7) NOT NULL DEFAULT '#2AC769',
  avatar_key   TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_display_name ON profiles (lower(display_name));
CREATE INDEX idx_profiles_username ON profiles (lower(username));
```

- [ ] `avatar_key` es la ruta en MinIO; `avatar_url` es la URL estable que devuelve el servicio.
- [ ] No guardar email ni contraseña.
- [ ] Migraciones con Alembic.

## 6. Eventos

**Consume**

- `profile.user.registered.q` ← `user.registered.v1`: crea la fila con `username`, `display_name = username` y color generado.
- `profile.user.updated.q` ← `user.updated.v1`: actualiza el snapshot de `username` si cambió.
- Opcional `profile.user.deleted.q` ← `user.deleted.v1`: borra perfil y avatar.

**Publica**

- `profile.updated.v1` al cambiar `displayName`, `about`, `color` o avatar.

Payload de `user.registered.v1` (sin color, porque auth ya no lo maneja):

```json
{
  "userId": "7b8339ec-...",
  "username": "ExploradorGeo",
  "email": "explorador@geochat.org",
  "registeredAt": "2026-10-24T14:30:00Z"
}
```

Payload de `profile.updated.v1`:

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

## 7. Requisitos no funcionales

- [ ] p95 < 150 ms en lecturas y < 400 ms en escrituras sin contar la subida.
- [ ] Subida máxima 5 MB; dimensiones máximas 4096×4096; mínimas 64×64.
- [ ] Formatos: JPEG, PNG, WebP. Rechazar SVG y GIF animado.
- [ ] Procesar imagen: quitar EXIF, corregir orientación, recorte cuadrado, redimensionar a 512×512, convertir a WebP calidad 85.
- [ ] Guardar en MinIO como `avatars/<userId>/<uuid>.webp`; borrar el anterior tras confirmar el nuevo.
- [ ] `Cache-Control: public, max-age=31536000, immutable` para avatares.
- [ ] Límite de 10 subidas por usuario por hora.
- [ ] No registrar binarios ni rutas locales.

## 8. Consejo técnico

**Recomendado:** Python 3.13 + FastAPI + SQLAlchemy 2 async + asyncpg + Alembic + Pydantic v2 + Pillow + MinIO SDK + `aio-pika`.

- Es el mismo stack de `auth` y `network`; el equipo ya conoce la estructura y el CI.
- Pillow resuelve EXIF, orientación y miniaturas.
- MinIO es S3-compatible: local sin AWS y producción cambiando el endpoint.
- Valida el MIME real abriendo la imagen con Pillow, no solo el header.

**Alternativa:** Go + chi + pgx + `disintegration/imaging` + MinIO SDK. Más rápido y con menos memoria, pero más código de imágenes y menos reutilización del stack Python.

**Trampas**

- No guardar imágenes en el filesystem del contenedor.
- No confiar en el `Content-Type` del cliente.
- No devolver binario desde un endpoint JSON.
- No duplicar `email` en `profiles`.

## 9. Tareas

- [ ] Crear `services/profile` con capas `handler`, `service`, `repository`, `domain`, `schema`, `core`.
- [ ] Migración de `profiles`.
- [ ] Configurar MinIO y bucket `geopicto-avatars`.
- [ ] Implementar CRUD, color y upload de avatar.
- [ ] Consumidor de `user.registered`/`user.updated` idempotente por clave natural (`user_id`).
- [ ] Backfill de usuarios existentes (script o creación perezosa).
- [ ] Tests unitarios y de integración (upload, formatos inválidos, batch).
- [ ] `README.md`, `.env.example`, `Dockerfile`, `docker-compose.yml`.
- [ ] Rutas en el gateway: avatares pública, resto con JWT.

## 10. Definition of Done

- [ ] El servicio aislado levanta con su BD y MinIO.
- [ ] Al registrarse un usuario aparece su perfil sin intervención manual.
- [ ] Se puede subir, ver y reemplazar un avatar.
- [ ] `GET /api/profiles/batch` resuelve 100 IDs.
- [ ] El perfil devuelve `color` y el frontend puede pintar autores.
- [ ] No se publica ningún puerto interno en el compose raíz.
