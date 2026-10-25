# Frontend — Cambios para Prototipo 2

> Este documento contiene **solo lo que falta cambiar** en el frontend existente. No repite lo que ya funciona.

## 1. Estado actual

El frontend es una app Expo/React Native (con build web) que consume el gateway mediante `apiClient`. Ya tiene login, mapa, mensajes y red social. El build web actual es **CSR** (`expo export -p web` + nginx), no SSR.

## 2. Cambios obligatorios

### 2.1. Quitar `color` de auth

- [ ] `User` de auth ya no tiene `color`.
- [ ] `AuthContext` no debe asumir color al iniciar sesión.
- [ ] El color de autor se obtiene de `profile` (`GET /api/profiles/batch` o `me`).
- [ ] Si un perfil no existe, derivar un color estable del `userId` como fallback.

### 2.2. Adaptar respuestas

- [ ] `auth`, `messages` y `network` conservan el sobre actual.
- [ ] `profile`, `rating`, `reputation` y `socket-gateway` devuelven el dato directo.
- [ ] Agregar a `apiClient` un método `requestRaw<T>()` que no espere `{ success, data }`, o normalizar en cada servicio.
- [ ] No romper el manejo actual de 401/refresh.

### 2.3. Servicios nuevos

- [ ] `profileService`: `GET /api/profiles/me`, `PATCH /api/profiles/me`, `POST /api/profiles/me/avatar`, `GET /api/profiles/{id}`, `GET /api/profiles/batch`.
- [ ] `ratingService`: `PUT/DELETE/GET /api/ratings/messages/{id}`, `POST /api/ratings/messages/batch`.
- [ ] `reputationService`: `GET /api/reputation/me`, `GET /api/reputation/{id}`, leaderboard, historial.
- [ ] `socketService`: `POST /api/socket/tickets` y conexión WebSocket.

### 2.4. Pantallas y componentes

- [ ] Modal/pantalla de perfil: nombre visible, about, avatar y color.
- [ ] Tarjeta de mensaje: botones like/dislike, conteos, estado optimista, deshabilitar en mensajes propios.
- [ ] Badge de reputación (nivel y progreso).
- [ ] Estado “en revisión” para mensajes `PENDING`.
- [ ] Badge de advertencia para `moderation_status = WARN`.
- [ ] Ocultar o marcar mensajes `BLOCKED`/`DELETED` para el autor.
- [ ] Toasts para `notification.requested`, `reputation.changed`, `moderation.completed`.
- [ ] Resolver autores con `profiles/batch` y ratings con `ratings/batch` para no hacer N+1.

### 2.5. WebSocket

- [ ] `RealtimeContext` con ticket, conexión, suscripciones y reconexión.
- [ ] Reconexión con backoff 1–30 s + jitter.
- [ ] Al reconectar: pedir ticket nuevo, abrir WS y re-suscribirse.
- [ ] Deduplicar eventos por `eventId`.
- [ ] Suscribirse a `user:<id>`, `message:<id>` y `global` según la pantalla.
- [ ] En SSR/web, abrir WebSocket solo en `useEffect` (nunca en render).
- [ ] Derivar la URL WS de `EXPO_PUBLIC_API_GATEWAY_URL` (`http`→`ws`, `https`→`wss`) o usar `EXPO_PUBLIC_WS_URL`.

### 2.6. Estados de mensaje

Mantener el tipo actual `pendiente|publicado|oculto|eliminado` y mapear:

| Backend | Frontend |
| --- | --- |
| `PENDING` | `pendiente` |
| `PUBLISHED` + `ALLOW` | `publicado` |
| `PUBLISHED` + `WARN` | `publicado` + badge advertencia |
| `BLOCKED` | `oculto` |
| `DELETED` | `eliminado` |

## 3. SSR (requisito del Prototipo 2)

El build web actual es CSR. Para cumplir SSR:

- **Opción A (recomendada):** crear un frontend web separado con Next.js 15 (App Router) que consuma el gateway y reutilice tipos/contratos. El móvil sigue en Expo. Esto también deja dos componentes de presentación claros.
- **Opción B:** migrar a Expo Router con `web.output: "server"` y desplegar un contenedor Node. Implica refactor de navegación y verificar SSR.

- [ ] Decidir antes de la fase de integración.
- [ ] Asegurar que ninguna pantalla use `window`, `localStorage` o WebSocket durante el render del servidor.
- [ ] Cargar datos iniciales en el servidor y hidratar en el cliente.

## 4. Consejo técnico

- Mantener TypeScript y los tipos compartidos.
- No meter lógica de negocio en el frontend: el backend ya decide moderación/reputación.
- Para el batch de perfiles/ratings, usar `Promise.all` una sola vez por pantalla.
- En web SSR, usar `useEffect` para WebSocket y `dynamic(..., { ssr: false })` si hace falta.
- El modo mock (`EXPO_PUBLIC_USE_MOCK_DATA`) debe seguir funcionando; agregar mocks de perfil, rating y reputación.

## 5. Tareas

- [ ] Actualizar tipos (`User` sin color, `UserProfile`, `RatingSummary`, `Reputation`, `RealtimeEvent`).
- [ ] Adaptar `apiClient` para respuestas directas.
- [ ] Implementar servicios y contextos nuevos.
- [ ] Actualizar pantallas de mensajes, perfil y notificaciones.
- [ ] Implementar reconexión WebSocket.
- [ ] Resolver autores/colores con `profile`.
- [ ] Agregar mocks.
- [ ] Implementar SSR (Next.js o Expo Router server).
- [ ] Probar login, mapa, mensajes, perfil, rating y notificaciones.

## 6. Definition of Done

- [ ] Login funciona sin `user.color`.
- [ ] Los mensajes muestran nombre/color desde `profile`.
- [ ] Like/dislike funciona y actualiza conteos.
- [ ] Se ve el nivel de reputación.
- [ ] Los mensajes pendientes/advertidos/bloqueados se muestran correctamente.
- [ ] Las notificaciones en tiempo real llegan y sobreviven a una reconexión.
- [ ] El frontend web cumple SSR.
- [ ] El modo mock sigue funcionando.
