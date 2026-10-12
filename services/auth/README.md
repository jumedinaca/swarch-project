# Servicio de autenticación

## Propósito y estado

Este componente gestiona la identidad de los usuarios de GeoPicto: registro, inicio de sesión, emisión y validación de tokens JWT y gestión de sesiones. Está escrito en **Python (FastAPI)** y persiste la información en **PostgreSQL**.

Es la pieza que permite que el API Gateway sepa quién hace cada petición. El gateway valida el token con este servicio y reenvía el identificador del usuario (`X-User-ID`, un UUID) al servicio de mensajes.

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
| `users` | `id` (UUID), `username` y `email` únicos sin distinguir mayúsculas, `password_hash` (Argon2id), `color` de avatar, `is_active`, contador de intentos fallidos, `locked_until`, `last_login_at` y marcas de tiempo. |
| `sessions` | Una fila por inicio de sesión: `user_id`, hash SHA-256 del refresh token, `user_agent`, `ip_address`, `expires_at`, `last_used_at` y `revoked_at`. |

## Seguridad implementada

- **Contraseñas con Argon2id.** Se re-hashean automáticamente si cambian los parámetros. Se usa un hash señuelo cuando el usuario no existe, para que el tiempo de respuesta no revele qué cuentas existen.
- **Access token JWT (HS256)** con los claims `sub` (id del usuario), `sid` (sesión), `username`, `iss`, `iat`, `exp` y `jti`. Por defecto dura 60 minutos.
- **Sesiones revocables.** Cada token apunta a una sesión en la base de datos. Por eso `logout` invalida el access token de inmediato, sin esperar a que expire.
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
| `JWT_SECRET` | Sí | — | Secreto para firmar los JWT (mínimo 32 caracteres). Debe compartirse con el gateway solo si este valida los tokens por su cuenta. |
| `PORT` | No | `8000` | Puerto HTTP dentro del contenedor. |
| `JWT_ALGORITHM` | No | `HS256` | Algoritmo de firma. |
| `JWT_ISSUER` | No | `geopicto-auth` | Valor del claim `iss`. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No | `60` | Vigencia del access token. |
| `REFRESH_TOKEN_EXPIRE_DAYS` | No | `7` | Vigencia de la sesión y del refresh token. |
| `JWT_LEEWAY_SECONDS` | No | `10` | Tolerancia de reloj al validar `exp` e `iat`. |
| `MAX_FAILED_LOGIN_ATTEMPTS` | No | `5` | Intentos fallidos antes de bloquear la cuenta. |
| `LOCKOUT_MINUTES` | No | `15` | Duración del bloqueo. |
| `CORS_ORIGINS` | No | vacío | Orígenes permitidos separados por coma. Si se deja vacío, el gateway se encarga del CORS. |

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
| `GET /auth/validate` | Bearer | **Para el gateway.** Responde `200` con las cabeceras `X-User-ID`, `X-User-Name`, `X-User-Color` y `X-Session-ID`, o `401` si el token no es válido. |
| `GET /auth/profile` | Bearer | Datos del usuario autenticado. |
| `PATCH /auth/profile` | Bearer | Cambia el color del avatar con `{ color: "#RRGGBB" }`. |
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
      "color": "#2AC769",
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

## Integración con el API Gateway

Para las rutas protegidas (por ejemplo `/api/messages/*`), el gateway:

1. Recibe la petición con `Authorization: Bearer <token>`.
2. Llama a `GET http://auth:8000/auth/validate` reenviando la misma cabecera `Authorization`.
3. Si recibe `200`, reenvía la petición al servicio de mensajes y agrega `X-User-ID` (y, si se necesitan, `X-User-Name` y `X-User-Color`). Si recibe `401`, devuelve esa misma respuesta al cliente.

Este flujo encaja con el patrón `auth_request` de nginx o con un middleware en cualquier gateway. Validar en el servicio de autenticación, y no solo la firma del JWT, permite que un `logout` invalide el token de inmediato.

## Pruebas

Las pruebas usan SQLite en un archivo temporal, así que no necesitan Docker:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest
```
