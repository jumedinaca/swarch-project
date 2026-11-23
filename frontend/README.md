# Frontend

El frontend está dividido en dos aplicaciones independientes:

| Carpeta | Descripción | Tecnología | Ruta pública (reverse proxy) |
| --- | --- | --- | --- |
| [`mobile/`](mobile/) | App móvil y web con mapa, notas en tiempo real y red de amigos. | Expo / React Native | `https://localhost/` |
| [`profile-web/`](profile-web/) | Panel de cuenta renderizado en el servidor (SSR): perfil, mensajes, reputación y red. | Next.js / React | `https://localhost/account`, `/login` |

## Desarrollo

```bash
# App móvil / web
cd mobile
npm install
npx expo start

# Panel de cuenta
cd profile-web
cp .env.example .env.local
npm install
npm run dev
```

Ambas aplicaciones consumen el API Gateway. La app móvil envía el token en el
header `Authorization`; el panel `profile-web` usa el gateway desde el servidor
de Next.js y guarda el JWT en cookies `HttpOnly`.

Para levantar todo el sistema:

```bash
# Desde la raíz del repositorio
docker compose up --build --wait
```

## Detrás del reverse proxy (HTTPS / WSS)

En el sistema completo ningún frontend publica puertos: el reverse proxy
perimetral (`nginx/`) termina TLS y sirve todo desde **un solo origen HTTPS**
(ver [`nginx/sites/https.conf`](../nginx/sites/https.conf)):

| Ruta | Destino interno | Uso |
| --- | --- | --- |
| `/api/ws` | `gateway:8080` (con `Upgrade`) | WebSocket de tiempo real (`wss://`) |
| `/api/*` | `gateway:8080` | REST y GraphQL |
| `/account`, `/login`, `/_next/*`, `/icon.svg`, `/logo.png` | `profile-web:3000` | Panel SSR, sus assets y Server Actions |
| `/*` | `frontend:80` | SPA Expo |

Cómo se adapta cada aplicación:

- **Expo (`mobile/`)**: en el navegador, cuando la página se sirve por
  `https:`, usa `window.location.origin` como URL del gateway y deriva
  `wss://<host>/api/ws`. Así no hay Mixed Content, ni CORS entre puertos, ni
  IPs incrustadas en el build, y funciona igual en `https://localhost`,
  `https://127.0.0.1` o la IP de la LAN. La app nativa y `expo start` usan
  `EXPO_PUBLIC_API_GATEWAY_URL` (por defecto `https://localhost`).
- **Next.js (`profile-web/`)**: no cambia de rutas (`/account` y `/login` ya
  son las suyas). Las cookies de sesión son `HttpOnly; Secure; SameSite=Lax`
  (`COOKIE_SECURE=true` en Compose; `Secure` por defecto en producción), así
  que el navegador nunca las envía por `http://`.
- **Backend**: `AVATAR_PUBLIC_BASE_URL` (profile), `CORS_ALLOWED_ORIGINS`
  (gateway) y `WS_ALLOWED_ORIGINS` (socket-gateway) usan el origen HTTPS
  público (`EXPO_PUBLIC_API_GATEWAY_URL`, `https://localhost` y
  `https://127.0.0.1`), sin orígenes `http://`.

`scripts/smoke-test.mjs` y `scripts/test-realtime.mjs` verifican todo esto de
punta a punta contra `https://localhost`.
