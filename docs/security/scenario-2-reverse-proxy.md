# Escenario de seguridad 2 — Reverse Proxy Pattern

**Responsable:** Persona 2 · **Rama:** `feat/security-edge-tls` (compartida con Persona 1, Escenario 1)

## 1. Problema

En `main`, tres servidores de aplicación se publican directamente al host:

| Contenedor | Puerto publicado | Qué revela |
| --- | --- | --- |
| `gateway` (Spring Cloud Gateway) | `:8080` | — |
| `frontend` (Expo web servido por Nginx) | `:8081` | `Server: nginx/1.31.8` |
| `profile-web` (Next.js SSR) | `:8082` | `X-Powered-By: Next.js` |

Cada uno atiende al cliente por su cuenta y debe defenderse solo: no hay un punto donde aplicar cabeceras de seguridad, límites de tamaño o timeouts de forma uniforme. Ninguno envía `X-Frame-Options`, `X-Content-Type-Options` ni `Referrer-Policy`, y un cuerpo de 7 MB enviado a `/api/auth/login` atraviesa el gateway y lo procesa el microservicio de autenticación (responde `422`), consumiendo sus recursos.

## 2. Escenario de calidad

| Parte | Descripción |
| --- | --- |
| **Fuente** | Atacante externo, sin credenciales, con acceso de red al host de despliegue. |
| **Estímulo** | Escanea los puertos publicados, identifica la tecnología y versión de cada servidor, y envía peticiones a los servidores de aplicación (incluidas peticiones de gran tamaño y páginas embebidas en un `<iframe>`). |
| **Artefacto** | Perímetro de red del sistema: `frontend`, `profile-web` y `api-gateway`. |
| **Entorno** | Operación normal, sistema desplegado con Docker Compose. |
| **Respuesta** | Todo el tráfico entra por un único Reverse Proxy (Nginx). Los servidores de aplicación no son alcanzables desde fuera de la red de Docker. El proxy oculta la tecnología y versión de los backends, agrega cabeceras de seguridad a todas las respuestas y rechaza en el borde las peticiones que exceden el tamaño o el tiempo permitido. |
| **Medida de la respuesta** | Puntos de entrada de aplicación publicados: **3 → 1** (`:8080`, `:8081`, `:8082` rechazan la conexión). Cabeceras de seguridad presentes: **0 → 3** en el 100 % de las respuestas. Encabezados que revelan versión/tecnología: **2 → 0**. Cuerpos > 6 MB: **rechazados con `413` en el proxy**, 0 bytes llegan al microservicio. `scripts/test-reverse-proxy.sh`: **9 EXPUESTO → 0 EXPUESTO**. |

## 3. Tácticas aplicadas

| Táctica (categoría) | Cómo se aplica |
| --- | --- |
| **Limitar la exposición** (Resistir ataques) | Un único servicio publicado (`reverse-proxy`, `:80`/`:443`); `gateway`, `frontend` y `profile-web` pierden `ports:` en `docker-compose.yml`. |
| **Limitar el acceso** (Resistir ataques) | Los backends solo aceptan tráfico desde la red interna de Docker; el proxy decide qué rutas existen (`/api/`, `/api/ws`, frontends por subdominio). Rutas no publicadas, como `/actuator/health` del gateway, no son alcanzables desde fuera. |
| **Reducir la divulgación de información** | `server_tokens off` (sin versión de Nginx), `proxy_hide_header X-Powered-By`; las cabeceras `Server` de los backends no se reenvían. |
| **Validar la entrada / limitar el consumo de recursos** | `client_max_body_size 6M` (avatares ≤ 5 MB), timeouts de cabecera, cuerpo, envío y hacia los backends para cortar conexiones lentas. |
| **Endurecer el canal hacia el navegador** | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, con `always` (también en errores). HSTS lo agrega el Escenario 1. |

## 4. Patrón aplicado: Reverse Proxy

Un intermediario en el borde recibe todas las peticiones de los clientes y las reenvía a los servidores internos; el cliente nunca se conecta a ellos directamente. Se implementa con **Nginx 1.27** (`nginx/`):

```
Navegador ──HTTPS :443──▶ reverse-proxy (Nginx)
                            ├─ app.localhost      /        ──▶ frontend:80
                            ├─ app.localhost      /api/*   ──▶ gateway:8080 ──▶ microservicios
                            ├─ app.localhost      /api/ws  ──▶ gateway:8080 ──▶ socket-gateway (WebSocket)
                            ├─ profile.localhost  /        ──▶ profile-web:3000
                            └─ localhost          /api/*   ──▶ gateway:8080   (resto → app.localhost)
```

Decisiones de diseño:

- **Enrutamiento por subdominio** (`app.localhost`, `profile.localhost`) en vez de por ruta (`/profile`): no exige cambiar el `basePath` de Next.js ni el código de los frontends. `*.localhost` resuelve a `127.0.0.1` en navegadores y curl sin editar `/etc/hosts`.
- **API en el mismo origen que la app** (`https://app.localhost/api`): el navegador no necesita CORS para las llamadas del frontend.
- **Resolución dinámica** (`resolver 127.0.0.11` + variables en `proxy_pass`): Nginx arranca aunque un backend no exista todavía y no usa IPs viejas si un contenedor se reinicia.
- **IP real del cliente**: el proxy sobrescribe `X-Real-IP` y `X-Forwarded-For` con la IP de la conexión, de modo que no se pueden falsificar desde fuera. El rate limiting del gateway (Escenario 4) usa `X-Real-IP` para identificar al cliente.
- **Relación con el API Gateway**: no se reemplazan. El Reverse Proxy es el perímetro de red (TLS, cabeceras, límites, enrutamiento por host); el API Gateway sigue siendo el punto de entrada de la aplicación (JWT, enrutamiento a microservicios, CORS, rate limiting).

Archivos (separados por responsable para evitar conflictos):

| Archivo | Contenido | Responsable |
| --- | --- | --- |
| `nginx/nginx.conf` | Global, hardening, resolver, `map` de WebSocket | Persona 2 |
| `nginx/sites/https.conf` | Servidores `:443` por subdominio | Persona 2 |
| `nginx/snippets/api-locations.conf` | `/api/` y `/api/ws` hacia el gateway | Persona 2 |
| `nginx/snippets/security-headers.conf` | Cabeceras de seguridad comunes | Persona 2 |
| `nginx/snippets/proxy-headers.conf` | `Host`, `X-Real-IP`, `X-Forwarded-*` | Persona 2 |
| `nginx/conf.d/ssl.conf` | Protocolos y certificados TLS (temporal) | Persona 1 |
| `nginx/snippets/hsts.conf` | HSTS (vacío) | Persona 1 |
| `nginx/sites/http.conf` | `:80` → `301` a HTTPS (temporal) + `/healthz` | Persona 1 |
| `nginx/certs/` | `cert.pem` / `key.pem` (no se versionan) | Persona 1 |

## 5. Demostración en clase (antes / después)

El mismo script se ejecuta en `main` y en la rama. Cada verificación observa un hecho reproducible con `curl`; la etiqueta `EXPUESTO` / `MITIGADO` es su interpretación.

**Antes (main, sin proxy):**

```bash
git checkout main
docker compose up -d --build --wait
./scripts/test-reverse-proxy.sh
```

Resultado esperado: `EXPUESTO: 9`, `Puntos de entrada publicados: 3` (ver `docs/security/evidence/scenario-2-before.txt`). En el navegador, `http://localhost:8082` abre profile-web directamente y DevTools → Network muestra `X-Powered-By: Next.js` y ninguna cabecera de seguridad.

**Después (rama del escenario, con proxy):**

```bash
docker compose down        # libera 8080/8081/8082 antes de cambiar de rama
git checkout feat/security-edge-tls
docker compose up -d --build --wait
./scripts/test-reverse-proxy.sh
```

Resultado esperado: `EXPUESTO: 0`, `MITIGADO: 10`, `Puntos de entrada publicados: 1` (ver `docs/security/evidence/scenario-2-after.txt`). En el navegador, `http://localhost:8082` ya no conecta y `https://profile.localhost` sí (aceptando la advertencia del certificado temporal). `docker compose ps` muestra puertos publicados solo en `reverse-proxy` (y en Mailpit, herramienta de desarrollo).

Notas:

- Si existe un `.env` con `EXPO_PUBLIC_API_GATEWAY_URL=http://localhost:8080` o `CORS_ALLOWED_ORIGINS` con los puertos viejos, quitar esas líneas (así se usan los valores por defecto de `docker-compose.yml`) y reconstruir el frontend; si no, la app Expo intentará llamar al puerto cerrado.
- Construir ambas versiones antes de la presentación: la compilación del frontend tarda varios minutos.
