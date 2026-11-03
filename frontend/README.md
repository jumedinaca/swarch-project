# Frontend

El frontend está dividido en dos aplicaciones independientes:

| Carpeta | Descripción | Tecnología | Puerto en Compose |
| --- | --- | --- | --- |
| [`mobile/`](mobile/) | App móvil y web con mapa, notas en tiempo real y red de amigos. | Expo / React Native | `8081` |
| [`profile-web/`](profile-web/) | Panel de cuenta renderizado en el servidor (SSR): perfil, mensajes, reputación y red. | Next.js / React | `8082` |

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

Ambas aplicaciones consumen el API Gateway (`http://localhost:8080`). El panel
`profile-web` usa el gateway desde el servidor de Next.js y guarda el JWT en una
cookie httpOnly; la app móvil envía el token en el header `Authorization`.

Para levantar todo el sistema:

```bash
# Desde la raíz del repositorio
docker compose up --build --wait
```
