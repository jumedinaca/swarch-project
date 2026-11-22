# Escenario de seguridad 1 — Secure Channel Pattern

**Responsable:** Persona 1 · **Rama:** `feat/security-edge-tls` (compartida con Persona 2, Escenario 2 y Persona 3, Integración Perimetral)

## 1. Problema

En la arquitectura base de `main`, todo el tráfico externo entre los clientes (navegador / app móvil) y los puntos de entrada del sistema (`frontend` en `:8081`, `profile-web` en `:8082` y `gateway` en `:8080`) viaja en texto plano mediante `http://` y `ws://`:

| Canal en `main` | Protocolo sin cifrar | Datos sensibles expuestos en tránsito |
| --- | --- | --- |
| `POST /api/auth/login`, `/register` | `http://localhost:8080` | Credenciales (`password`), tokens JWT (`access_token`, `refresh_token`) |
| `POST /api/messages`, `GET /api/messages/nearby` | `http://localhost:8080` | Coordenadas GPS exactas del usuario (`latitude`, `longitude`) y contenido |
| `/api/ws?ticket=...` | `ws://localhost:8080` | Tickets de conexión y eventos en tiempo real (mensajes, votos, presencia) |
| Panel SSR (`profile-web`) | `http://localhost:8082` | Cookies de sesión sin atributo `Secure` (`COOKIE_SECURE=false`) |

Un atacante situado en la misma red local o en un salto intermedio (*Man-in-the-Middle* / *Eavesdropping*) puede interceptar credenciales, robar tokens JWT o manipular coordenadas geográficas sin ser detectado, además de forzar degradación de protocolo (*SSL Stripping*) por ausencia de redirección obligatoria y de cabecera `Strict-Transport-Security` (HSTS).

## 2. Escenario de calidad

| Parte | Descripción |
| --- | --- |
| **Fuente** | Atacante externo en una red no confiable (Wi-Fi pública o salto intermedio) ejecutando escucha pasiva (*Eavesdropping*) o intercepción activa (*Man-in-the-Middle*). |
| **Estímulo** | Intenta capturar o alterar en tránsito credenciales de inicio de sesión, tokens JWT, cookies de sesión, tramas WebSocket en tiempo real o coordenadas GPS del usuario, o forzar conexiones en texto plano (`http://` / `ws://`) o con protocolos TLS obsoletos (`TLS 1.0` / `TLS 1.1`). |
| **Artefacto** | Canal de comunicación externo entre el cliente (navegador / app móvil) y el borde perimetral (`reverse-proxy` en `:80` y `:443`). |
| **Entorno** | Operación normal del sistema desplegado sobre redes públicas o no confiables. |
| **Respuesta** | El borde perimetral termina TLS 1.2 y TLS 1.3 con suites de cifrado AEAD y *Forward Secrecy* (`https://` y `wss://`), rechaza protocolos obsoletos (`SSLv3`, `TLS 1.0`, `TLS 1.1`), redirige obligatoriamente cualquier petición HTTP (`:80`) hacia HTTPS (`:443`) con `301 Moved Permanently` e inyecta la cabecera `Strict-Transport-Security` (HSTS) en todas las respuestas. |
| **Medida de la respuesta** | **100 %** del tráfico externo REST, GraphQL, SSR y WebSocket viaja cifrado con **TLS 1.2 (`ECDHE-*-GCM`) o TLS 1.3 (`TLS_AES_*_GCM`)**; **0** credenciales o tokens transmitidos en texto plano; **100 %** de las peticiones HTTP en `:80` retornan `301` hacia `https://`; **100 %** de las respuestas HTTPS incluyen `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`; **21/21 PASS** en `scripts/test-secure-channel.sh`. |

## 3. Tácticas aplicadas

| Táctica (categoría) | Cómo se aplica |
| --- | --- |
| **Cifrar los datos en tránsito — *Encrypt Data*** (Resistir ataques) | Terminación TLS 1.2 y TLS 1.3 en el contenedor `reverse-proxy` (`:443`) tanto para peticiones HTTP (`https://`) como para conexiones WebSocket (`wss://`). |
| **Endurecer parámetros criptográficos** (Resistir ataques) | `ssl_protocols TLSv1.2 TLSv1.3;` deshabilita `SSLv2`, `SSLv3`, `TLS 1.0` y `TLS 1.1`. `ssl_ciphers` restringe TLS 1.2 exclusivamente a cifrados autenticados AEAD con intercambio efímero `ECDHE` (`AES-GCM` y `CHACHA20-POLY1305`) y curvas `X25519:prime256v1:secp384r1`. `ssl_session_tickets off;` preserva *Perfect Forward Secrecy* (PFS). |
| **Prevenir degradación de protocolo (HSTS + Redirección 301)** (Resistir ataques) | El servidor `:80` responde `301 Moved Permanently` hacia `https://$host$request_uri`, y todas las respuestas `:443` incluyen `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` con el modificador `always`. |
| **Gestión verificable de identidad X.509v3** (Resistir ataques) | `scripts/generate-certs.sh` genera una PKI local de 2 niveles: una Autoridad Certificadora raíz local (`ca.pem`, RSA 4096) que firma el certificado del servidor (`cert.pem`, RSA 2048) con extensiones `subjectAltName` para `localhost`, `*.localhost`, `app.localhost`, `profile.localhost` y `127.0.0.1`. |

## 4. Patrón aplicado: Secure Channel Pattern

Todo el tráfico que cruza la frontera externa del sistema viaja por un canal criptográficamente autenticado y cifrado, terminando TLS en el borde (`reverse-proxy`) antes de enrutar hacia la red interna de Docker:

```
Cliente (Navegador / App)
  │
  ├── HTTP  :80  ──▶ reverse-proxy ──▶ 301 Moved Permanently ──▶ https://$host$request_uri
  │
  ├── HTTPS :443 ──▶ reverse-proxy (Terminación TLS 1.2 / 1.3 + HSTS)
  │                    ├─ https://app.localhost/        ──▶ frontend:80
  │                    ├─ https://profile.localhost/    ──▶ profile-web:3000
  │                    └─ https://*/api/*               ──▶ gateway:8080
  │
  └── WSS   :443 ──▶ reverse-proxy (Terminación TLS + Upgrade: websocket)
                       └─ wss://app.localhost/api/ws    ──▶ gateway:8080 ──▶ socket-gateway:8080
```

Archivos del Escenario 1 (Persona 1):

| Archivo | Contenido |
| --- | --- |
| `scripts/generate-certs.sh` | Generador automatizado de CA raíz local (`ca.pem`, `ca-key.pem`) y certificado de servidor X.509v3 (`cert.pem`, `key.pem`, `fullchain.pem`) con SANs para `localhost`, `*.localhost`, `app.localhost`, `profile.localhost` y `127.0.0.1`. Soporta OpenSSL y `mkcert`. |
| `nginx/conf.d/ssl.conf` | Configuración criptográfica TLS 1.2 / 1.3, suites AEAD con *Forward Secrecy*, curvas ECDHE (`X25519`, `P-256`, `P-384`), caché de sesión y `ssl_session_tickets off`. |
| `nginx/snippets/hsts.conf` | Cabecera `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` con `always`. |
| `nginx/sites/http.conf` | Servidor en puerto `:80` con redirección obligatoria `301 Moved Permanently` a `https://$host$request_uri` (preservando `/healthz` para el healthcheck interno de Docker). |
| `nginx/docker-entrypoint.d/40-tls-certs.sh` | Carga en `/etc/nginx/tls/` la cadena completa `fullchain.pem`/`cert.pem`, `key.pem` y `ca.pem` generados en `nginx/certs/`. |
| `scripts/test-secure-channel.sh` | Suite automatizada de 21 verificaciones: validez criptográfica de certificados y SANs, directivas de `nginx/`, redirección `301` desde `:80`, negociación TLS 1.3 y TLS 1.2, cabecera HSTS, rechazo de TLS 1.0/1.1, rechazo de clientes sin CA válida y upgrade `wss://`. |

## 5. Verificación reproducible

```bash
# 1. Generar la CA local y los certificados TLS en nginx/certs/
./scripts/generate-certs.sh

# 2. Levantar el entorno con el Reverse Proxy TLS
docker compose up -d --build --wait

# 3. Ejecutar la suite automatizada del Escenario 1
./scripts/test-secure-channel.sh

# 4. Verificar manualmente con curl -k -I (TLS 1.2/1.3 + HSTS + 301)
curl -I http://localhost/api/messages/nearby
curl -k -I https://localhost/healthz
```
