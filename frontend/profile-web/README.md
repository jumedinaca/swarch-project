# Profile Web — Panel SSR de cuenta

Aplicación **Next.js** que administra la cuenta de un explorador de GeoPicto:
perfil, mensajes geolocalizados, reputación y red de amigos. Los datos iniciales
se cargan en el servidor (SSR) y se entregan ya renderizados al navegador.

La estética reutiliza el tema Nintendo/PictoChat de `frontend/mobile`: papel
cuadriculado, tarjetas bento, tipografía monoespaciada para etiquetas, chips,
bordes retro y acentos Famicom rojo, Wii azul y Miiverse verde.

## Ejecutar

### Desarrollo local

```bash
cd frontend/profile-web
cp .env.example .env.local
npm install
npm run dev
```

Abre `http://localhost:3000`. El API Gateway debe estar en
`http://localhost:8080` (variable `API_GATEWAY_URL`).

### Docker Compose

Desde la raíz del repositorio:

```bash
docker compose up --build profile-web
```

El panel queda publicado en `http://localhost:8082`. Next.js corre en modo
standalone dentro del contenedor y usa `API_GATEWAY_URL=http://gateway:8080`
para la red interna de Compose.

## Modos de uso

| Modo | Cuándo | Comportamiento |
| --- | --- | --- |
| **Live** | Hay JWT en cookie httpOnly | Cada vista se renderiza con datos reales del API Gateway y las mutaciones se envían por Server Actions. |
| **Cuenta de ejemplo** | Se abre `/account?demo=1` sin sesión | Perfil, notas, reputación y amigos de ejemplo. Los formularios funcionan en memoria para presentar la interfaz. |

Sin sesión, `/account` redirige a `/login`. La cuenta de ejemplo está disponible
desde el enlace secundario del formulario de acceso.

El login usa `POST /api/auth/login`. El access token se guarda en la cookie
`gp_profile_access` (httpOnly) y el refresh token en `gp_profile_refresh`. El
archivo `src/proxy.ts` renueva el access token antes de renderizar `/account`
cuando vence.

## Datos y endpoints

| Sección | Endpoints |
| --- | --- |
| Perfil | `GET/PATCH /api/profiles/me`, `POST/DELETE /api/profiles/me/avatar`, `GET /api/profiles/batch`, `GET /api/profiles/search` |
| Mensajes | `GET /api/messages/nearby`, `POST /api/messages`, `DELETE /api/messages/{id}` |
| Reputación | `GET /api/reputation/me`, `GET /api/reputation/{userId}/history`, `POST /api/reputation/{userId}/recompute` |
| Red | `POST /api/network/graphql` (`friends`, `incomingRequests`, `outgoingRequests` y mutaciones) |
| Sesión | `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout` |

El feed de mensajes usa la zona del campus (`4.6382, -74.0841`, radio 1500 m)
porque el servicio de mensajes solo expone búsqueda por proximidad. Las notas
recién creadas pueden tardar en aparecer mientras la moderación las aprueba.

## Estructura

```
src/
├── app/
│   ├── account/
│   │   ├── actions.ts      # Server Actions: perfil, mensajes, red, reputación
│   │   ├── loading.tsx
│   │   └── page.tsx        # SSR: sesión → datos reales; ?demo=1 → cuenta de ejemplo
│   ├── login/
│   │   ├── actions.ts      # Login/logout con cookies httpOnly
│   │   └── page.tsx
│   ├── globals.css         # Tema visual heredado del móvil
│   ├── layout.tsx
│   └── page.tsx
├── components/             # Workspace y paneles de presentación
├── lib/
│   ├── account.ts          # Carga SSR de perfil, mensajes, reputación y red
│   ├── demo-data.ts        # Datos de demostración
│   ├── gateway.ts          # Cliente del API Gateway para el servidor
│   ├── session.ts          # Cookies y sesión
│   └── theme.ts            # Paleta y constantes del tema
└── proxy.ts                # Refresco de JWT antes del render SSR
```

## Variables de entorno

| Variable | Descripción |
| --- | --- |
| `API_GATEWAY_URL` | URL interna del gateway. En local `http://localhost:8080`; en Compose `http://gateway:8080`. |
| `COOKIE_SECURE` | `true` si el panel se publica por HTTPS para marcar las cookies como `Secure`. |

## Verificación

```bash
npm run typecheck
npm run build
```

`/account` responde con HTML renderizado en el servidor. Si hay sesión consulta el
gateway antes de responder; si no hay sesión redirige a `/login`. La cuenta de
ejemplo se abre explícitamente con `/account?demo=1`.
