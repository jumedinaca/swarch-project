# Servicio de autenticación

## Propósito y estado

Este componente gestiona la identidad de los usuarios de GeoPicto: registro, inicio de sesión, emisión y validación de tokens JWT y gestión de sesiones. Está escrito en **Python (FastAPI)** y persiste la información en **PostgreSQL**.

Es la pieza que permite que el API Gateway sepa quién hace cada petición: emite los JWT que el gateway verifica y cuyo `sub` (un UUID) reenvía como `X-User-ID` a los demás servicios.

El código se organiza en las mismas capas que el servicio de mensajes:

- `app/main.py`: crea la aplicación, configura CORS, los manejadores de errores, las rutas y `/health`.
- `app/handler`: rutas HTTP, dependencias (sesión de BD, usuario autenticado) y formato de errores.
- `app/service`: reglas de negocio (registro, login, bloqueo por intentos, rotación de tokens, sesiones).
- `app/repository`: consultas a la base de datos.
- `app/domain`: modelos `User` y `Session` (SQLAlchemy).
- `app/schema`: contratos de entrada y salida (Pydantic, en camelCase para el frontend).
- `app/core`: configuración y utilidades de seguridad (Argon2, JWT y refresh tokens).
- `migrations`: esquema versionado con Alembic.
- `tests`: pruebas de la API (pytest).

### Modelo de datos

| Tabla | Contenido |
| --- | --- |
| `users` | `id` (UUID), `username` y `email` únicos sin distinguir mayúsculas, `password_hash` (Argon2id), `is_active`, `is_admin` (reservado, sin uso en P2), contador de intentos fallidos, `locked_until`, `last_login_at` y marcas de tiempo. Este servicio no guarda datos públicos de perfil (`displayName`, `about`, `avatarUrl`, `color`): esos pertenecen a `profile`. |
| `sessions` | Una fila por inicio de sesión: `user_id`, hash SHA-256 del refresh token, `user_agent`, `ip_address`, `expires_at`, `last_used_at` y `revoked_at`. |

## Seguridad implementada

- **Contraseñas con Argon2id.** Se re-hashean automáticamente si cambian los parámetros. Se usa un hash señuelo cuando el usuario no existe, para que el tiempo de respuesta no revele qué cuentas existen.
- **Access token JWT (HS256)** con los claims `sub` (id del usuario, siempre un UUID), `sid` (sesión), `username`, `iss`, `iat`, `exp` y `jti`. Por defecto dura 15 minutos; ver [Integración con el API Gateway](#integración-con-el-api-gateway).
- **Sesiones revocables.** Cada token apunta a una sesión en la base de datos. `logout` revoca la sesión: el refresh token deja de servir de inmediato y las rutas de este servicio rechazan el access token. En el resto del sistema el access token deja de servir cuando expira (ver abajo).
- **Refresh token opaco y rotativo** (con formato `<sessionId>.<secreto>`). En la base de datos solo se guarda su hash. Si alguien reutiliza un refresh token que ya fue rotado, se asume robo y se revoca toda la sesión.
- **Bloqueo temporal de la cuenta** después de `MAX_FAILED_LOGIN_ATTEMPTS` intentos fallidos. Mientras dure, el login responde `423`.
- Al **cambiar la contraseña** se cierran todas las demás sesiones abiertas.
- Hay una **tolerancia de reloj** (`JWT_LEEWAY_SECONDS`) para cuando los contenedores tienen relojes ligeramente desfasados.
- El contenedor se ejecuta con un **usuario sin privilegios**.

## Ejecución con Docker Compose

Desde este directorio:

```powershell
Copy-Item .example.env .env
docker compose up --build
```

La API queda publicada en `http://localhost:8200` y su documentación interactiva (Swagger) en `http://localhost:8200/docs`. El contenedor aplica las migraciones pendientes al iniciar.

| Variable | Obligatoria | Valor por defecto | Descripción |
| --- | --- | --- | --- |
| `DATABASE_URL` | Sí | — | Cadena de conexión PostgreSQL (`postgresql://usuario:clave@host:puerto/bd`). |
| `JWT_SECRET` | Sí | — | Secreto para firmar los JWT (mínimo 32 caracteres). Debe ser el mismo `JWT_SECRET` del API Gateway, que verifica los tokens con él. |
| `PORT` | No | `8000` | Puerto HTTP dentro del contenedor. |
| `JWT_ALGORITHM` | No | `HS256` | Algoritmo de firma. |
| `JWT_ISSUER` | No | `geopicto-auth` | Valor del claim `iss`. El gateway exige este mismo valor. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No | `15` | Vigencia del access token. Es también el tiempo máximo que un token sigue sirviendo tras un logout. |
| `REFRESH_TOKEN_EXPIRE_DAYS` | No | `7` | Vigencia de la sesión y del refresh token. |
| `JWT_LEEWAY_SECONDS` | No | `10` | Tolerancia de reloj al validar `exp` e `iat`. |
| `MAX_FAILED_LOGIN_ATTEMPTS` | No | `5` | Intentos fallidos antes de bloquear la cuenta. |
| `LOCKOUT_MINUTES` | No | `15` | Duración del bloqueo. |
| `CORS_ORIGINS` | No | vacío | Orígenes permitidos separados por coma. Detrás del gateway debe quedar vacío: el gateway ya agrega las cabeceras CORS y, si ambos las ponen, el navegador rechaza la respuesta. |
| `RABBITMQ_URL` | No | vacío | Cadena AMQP para publicar eventos. Si está vacía, el servicio arranca y funciona, pero no publica eventos. |
| `RABBITMQ_EXCHANGE` | No | `geopicto.events` | Exchange de tipo `topic` donde se publican los eventos. |

## API HTTP

Todas las respuestas usan el formato que espera `apiClient.ts` del frontend:

```json
{ "success": true, "data": { ... }, "message": "..." }
{ "success": false, "error": "codigo_error", "message": "Mensaje legible en español" }
```

El servicio expone sus rutas bajo `/auth`. El gateway debe enrutar `/api/auth/*` hacia `/auth/*`, quitando el prefijo `/api`, igual que hace con mensajes.

| Método y ruta | Autenticación | Descripción |
| --- | --- | --- |
| `POST /auth/register` | — | Crea un usuario. Recibe `{ username, email, password }` y responde `201` con `user`, `token` y `refreshToken`. |
| `POST /auth/login` | — | Recibe `{ usernameOrEmail, password }` y responde `200` con `user`, `token` y `refreshToken`. |
| `POST /auth/refresh` | — | Recibe `{ refreshToken }` y entrega un access token y un refresh token nuevos (rotación). |
| `GET /auth/profile` | Bearer | Datos de identidad del usuario autenticado. La edición del perfil público pasa a `PATCH /api/profiles/me`. |
| `PUT /auth/password` | Bearer | Recibe `{ currentPassword, newPassword }` y cierra las demás sesiones. |
| `POST /auth/logout` | Bearer | Revoca la sesión actual. |
| `POST /auth/logout-all` | Bearer | Revoca todas las sesiones del usuario. |
| `GET /auth/sessions` | Bearer | Lista las sesiones activas y marca la actual con `current: true`. |
| `DELETE /auth/sessions/{id}` | Bearer | Revoca una sesión específica del usuario. |
| `GET /health` | — | Estado del servicio y de la base de datos. |

Ejemplo de respuesta de login o registro:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "7b8339ec-2e38-47b3-9d3b-7643652f1fc7",
      "username": "ExploradorGeo",
      "email": "explorador@geochat.org",
      "isActive": true,
      "createdAt": "2026-10-12T00:38:01.092780Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "701e9fda-aaee-46e1-a43b-f3b3b2914010.Rm_QRAwf...",
    "tokenType": "Bearer",
    "expiresIn": 3600
  },
  "message": null
}
```

### Códigos de error

| HTTP | `error` | Cuándo |
| --- | --- | --- |
| 401 | `invalid_credentials` | Usuario o contraseña incorrectos. |
| 401 | `missing_token` / `invalid_token` | Falta el token, es inválido, expiró o su sesión fue revocada. |
| 403 | `user_inactive` | La cuenta está desactivada. |
| 404 | `session_not_found` | La sesión que se intenta revocar no existe o no pertenece al usuario. |
| 409 | `username_taken` / `email_taken` | El usuario o el correo ya están registrados. |
| 422 | `validation_error` | Los datos de entrada no son válidos. `message` explica el problema. |
| 423 | `account_locked` | La cuenta está bloqueada temporalmente por intentos fallidos. |

## Eventos publicados

Después del commit del registro se publica `user.registered.v1` en el exchange `topic` `geopicto.events`, con routing key `user.registered.v1` (las colas de `profile` y `email` se enlazan a esa routing key). El payload no incluye `color`: el color lo genera `profile`.

```json
{
  "eventId": "0192f3a4-7b2c-7d1e-8f00-123456789abc",
  "eventType": "user.registered.v1",
  "version": 1,
  "occurredAt": "2026-10-24T14:30:00Z",
  "producer": "auth",
  "correlationId": "b3b1c2d4-...",
  "causationId": null,
  "payload": {
    "userId": "7b8339ec-...",
    "username": "ExploradorGeo",
    "email": "explorador@geochat.org",
    "registeredAt": "2026-10-24T14:30:00Z"
  }
}
```

- No hay outbox ni tabla de eventos procesados en P2. Si RabbitMQ falla, el registro responde `201` igualmente y el error queda en el log.
- `user.updated.v1` queda documentado para cuando exista un endpoint de cambio de `username`; hoy no se publica.
- Las cabeceras AMQP incluyen `x-event-id`, `x-event-type` y `x-correlation-id`, y el mensaje es persistente.

## Integración con el API Gateway

El gateway verifica los access tokens **por su cuenta**, con el mismo `JWT_SECRET`, sin llamar a este servicio. El contrato completo está en [`docs/jwt-contract.md`](../../docs/jwt-contract.md).

1. El frontend llama a `/api/auth/*`; el gateway quita `/api` y reenvía a `/auth/*` en este servicio, sin exigir token.
2. Para las rutas protegidas (por ejemplo `/api/messages/*`), el gateway comprueba la firma, `exp`, `iss` (`geopicto-auth`) y que `sub` sea un UUID. Si todo es válido, elimina `Authorization` y agrega `X-User-ID: <sub>` antes de reenviar.
3. Los demás servicios confían en `X-User-ID` y no validan tokens.

Consecuencia: el gateway no consulta la tabla `sessions`, así que tras un `logout` el access token sigue sirviendo en las rutas protegidas hasta que expira. Por eso dura solo 15 minutos y el frontend debe renovarlo con `POST /auth/refresh`, que sí falla de inmediato si la sesión fue revocada.

Se eligió así para que cada petición no dependa de este servicio ni de su base de datos. Si en el futuro se necesita revocación inmediata, el gateway tendría que consultar la sesión antes de reenviar.

## Pruebas

Las pruebas usan SQLite en un archivo temporal, así que no necesitan Docker:

```bash
uv sync
uv run pytest
```
