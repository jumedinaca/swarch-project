# GeoPicto — Suite de carga: datos de prueba y escenarios k6 (Persona 7)

Esta carpeta tiene dos partes que se complementan:

| Parte | Responsable | Qué hace | Documentación |
| :-- | :-- | :-- | :-- |
| **Workload design & scripting** | Persona 7 | Siembra datos realistas (`seed-data.mjs`) y define los 4 flujos de carga (`scenarios/`) | este archivo |
| **Ejecución, métricas y análisis** | Persona 8 | Corre Load / Stress / Spike, mide CPU/RAM por contenedor y genera las gráficas y el informe | [`README-P8.md`](README-P8.md) |

Las dos partes ya están conectadas: `run-performance-suite.sh` (Persona 8) ejecuta `seed-data.mjs` automáticamente y puede usar los escenarios de `scenarios/` como script de carga.

---

## 1. Requisitos

- **Stack de GeoPicto levantado:** `docker compose up --build -d --wait` desde la raíz del repo.
- **Node.js ≥ 18**, para el seeder (usa `fetch` nativo y no necesita `npm install`).
- **k6**: se recomienda instalarlo localmente ([guía](https://grafana.com/docs/k6/latest/set-up/install-k6/)). `winget install k6`, `brew install k6` o `choco install k6`.
  Si no está instalado, `run-scenarios.sh` usa automáticamente la imagen `grafana/k6:0.54.0` en Docker.
- **Bash**, para los runners. En Windows sirve Git Bash.

---

## 2. Inicio rápido

```bash
# Desde la raíz del repo, con el stack arriba:

# a) Prueba de humo: siembra y ejecuta los 5 escenarios con 5 VUs x 20 s
./performance/run-scenarios.sh --smoke

# b) Perfil completo por flujo (rampa 25 -> 50 -> 100 VUs, ~3 min por flujo)
./performance/run-scenarios.sh --label p3-flujos

# c) Batería de la Persona 8 (Load/Stress/Spike + CPU/RAM + gráficas),
#    usando la carga mixta de la Persona 7
CUSTOM_K6_SCRIPT=performance/scenarios/mixed.js \
  ./performance/run-performance-suite.sh --label p3-hardened
```

La salida de `run-scenarios.sh` queda en `performance/results/p7-<label>/`:

```
p7-<label>/
├── summary.md          tabla consolidada lista para el documento
├── summary.csv         la misma tabla para hoja de cálculo
├── summary.json
└── <flujo>/            nearby | write | auth | graphql | mixed
    ├── report.html     reporte HTML interactivo de k6 (latencias en el tiempo, RPS, errores)
    ├── summary.json    resumen de k6 (--summary-export, incluye p(99))
    ├── metrics.csv.gz  cada muestra de cada métrica (para análisis propio)
    ├── console.txt     salida de k6
    └── run_meta.json   parámetros de la corrida
```

---

## 3. Datos de prueba — `seed-data.mjs`

```bash
node performance/seed-data.mjs                         # valores por defecto
node performance/seed-data.mjs --users 300 --bulk 50000
node performance/seed-data.mjs --skip-bulk             # solo vía API (sin Docker)
node performance/seed-data.mjs --clean-bulk            # borra el volumen SQL y sale
```

| Paso | Qué crea | Cómo | Por defecto |
| :-- | :-- | :-- | --: |
| 1 | Usuarios `perf_user_NNN` (contraseña `PerfTest123!`) | `POST /api/auth/register`. Si ya existe, `login` | `SEED_USERS=200` |
| 2 | Grafo social "small world": cada usuario con ≈6 amigos y 2 solicitudes pendientes | GraphQL `sendFriendRequest` / `acceptFriendRequest` | `SEED_FRIENDS=6`, `SEED_PENDING=2` |
| 3 | Mensajes **calificables** que recorren todo el pipeline: messages → RabbitMQ → moderation → `PUBLISHED` → proyección en rating | `POST /api/messages`. El seeder espera a que la moderación los publique y a que rating los proyecte | `SEED_MESSAGES=400` |
| 4 | Mensajes de **volumen** para PostGIS (`PUBLISHED`, marcados `moderation_reason='perf-seed-bulk'`) | `INSERT` masivo en `messages-db` vía `docker exec … psql` | `SEED_BULK_MESSAGES=20000` |

**Distribución geográfica.** Los mensajes se reparten por Bogotá según [`scenarios/lib/geo-data.js`](scenarios/lib/geo-data.js): 9 *hotspots* con distribución normal (UNAL concentra el 30 %, y Chapinero, el Centro, los Andes, Parque 93, Usaquén, Salitre, Suba y Kennedy el resto) más un 6 % de fondo uniforme. Así una consulta `/nearby` puede devolver cientos de mensajes en una zona densa o ninguno en las afueras, como ocurriría con usuarios reales. Al terminar, el seeder imprime una tabla de densidad (mensajes por zona y radio) que sirve para interpretar las latencias.

**¿Por qué dos vías de mensajes?** Crear 20.000 mensajes por la API tardaría mucho y saturaría moderación antes de empezar la prueba. Por eso el volumen se inserta por SQL, pero solo sirve para el flujo de lectura. Los mensajes que se califican en el Flujo 2 sí tienen que haber pasado por RabbitMQ, porque rating solo acepta mensajes que ya proyectó.

**Idempotencia.** Si se vuelve a ejecutar, reutiliza usuarios, no duplica amistades, reutiliza los mensajes calificables del manifest anterior que sigan siendo válidos e inserta solo el volumen que falte. Con `SEED_RANDOM_SEED` igual se generan los mismos puntos.

**Salida: `performance/.seed-manifest.json`** (ignorado por git). Mantiene el contrato que usa `profiles/common.js` de la Persona 8 (`users[]` con `id`, `email`, `password` y `token`, y `messages[]` con `id`, `authorId`, `lat` y `lng`), y agrega `hotspots` y `stats` (densidad, grafo social, volumen).

> **Rate limiting (Escenario 4).** El seeder reintenta los `429` respetando `Retry-After`, pero lo más rápido es sembrar con el rate limiting desactivado (`RATE_LIMIT_ENABLED=false`).

| Variable | Defecto | Descripción |
| :-- | :-- | :-- |
| `BASE_URL` | auto | `https://localhost` (P3) o `http://localhost:8080` (P2) |
| `SEED_CONCURRENCY` | `8` | Peticiones simultáneas del seeder |
| `SEED_PASSWORD` | `PerfTest123!` | Contraseña de los usuarios de prueba |
| `SEED_PUBLISH_TIMEOUT_MS` | `90000` | Espera máxima a moderación y proyección de rating |
| `COMPOSE_PROJECT` / `MESSAGES_DB_CONTAINER` | `geopicto` / auto | Para encontrar el contenedor de `messages-db` |
| `INSECURE_TLS` | `true` | Acepta el certificado autofirmado del Reverse Proxy |

---

## 4. Escenarios — `scenarios/`

| Script | Flujo | Endpoints | Qué estresa |
| :-- | :-- | :-- | :-- |
| [`nearby.js`](scenarios/nearby.js) | 1. Lectura geoespacial | `GET /api/messages/nearby` | PostGIS `ST_DWithin` + índice GIST. La respuesta no pagina, así que el tamaño crece con la densidad |
| [`write.js`](scenarios/write.js) | 2. Escritura + eventos | `POST /api/messages`, `PUT /api/ratings/messages/:id` | Escrituras en Postgres, publicación en RabbitMQ, moderación y reputación |
| [`auth.js`](scenarios/auth.js) | 3. Autenticación | `POST /api/auth/login` | CPU por Argon2id en auth-service |
| [`graphql.js`](scenarios/graphql.js) | 4. Grafo social | `POST /api/network/graphql` | Resolvers GraphQL + MongoDB |
| [`mixed.js`](scenarios/mixed.js) | Mixto | los cuatro (50/20/20/10) | El sistema completo. Reemplaza a `profiles/load.js` y `profiles/stress.js` |

Cómo se modela a los usuarios:

- **Un VU es un usuario con su sesión.** Cada VU usa siempre el mismo usuario sembrado, publica cerca de su zona y consulta el mapa desde puntos realistas: 80 % cerca de un hotspot, 10 % en zonas vacías y 10 % en cualquier punto, con radios de 100 m a 2 km.
- **Los tokens se renuevan solos.** El access token dura 15 minutos. `setup()` renueva todas las sesiones si el manifest vence pronto, y si aun así llega un `401` el VU vuelve a iniciar sesión y reintenta una vez. Ese tráfico se etiqueta `flow=token_refresh` y no contamina las métricas del flujo.
- **El Flujo 2 mide el pipeline asíncrono.** Con `ASYNC_PROBE_RATE` (0.03 en `run-scenarios.sh`), una fracción de los mensajes creados se consulta hasta que la moderación decide. Así se obtiene `message_publish_latency`, el tiempo real de messages → RabbitMQ → moderation → messages, que el `201` del POST no refleja.
- **El Flujo 3 incluye intentos fallidos.** El 10 % usa una contraseña incorrecta (`401` esperado). También pagan el costo de Argon2 y es el patrón típico de un ataque de fuerza bruta.

### Ejecutarlos directamente con k6

```bash
k6 run performance/scenarios/nearby.js                                    # rampa por defecto
k6 run -e MODE=single -e VUS=200 -e DURATION=1m performance/scenarios/graphql.js
k6 run -e MODE=rate -e RATE=20 -e DURATION=1m performance/scenarios/auth.js   # modelo abierto
k6 run -e STAGES="30s:50,2m:300,30s:0" performance/scenarios/mixed.js
k6 run -e BASE_URL=https://localhost performance/scenarios/write.js
```

| Modo (`MODE`) | Parámetros | Cuándo usarlo |
| :-- | :-- | :-- |
| `stages` (defecto) | `STAGES="dur:vus,…"` | Rampa de usuarios concurrentes |
| `single` | `VUS`, `DURATION` | Nivel fijo. Es el que usa `run-performance-suite.sh` en cada escalón |
| `rate` | `RATE` (it/s), `DURATION`, `PRE_VUS`, `MAX_VUS` | Modelo abierto: llegan N peticiones/s sin importar cuánto tarde el sistema. Evita que la latencia frene la carga y da tiempos de respuesta honestos cerca de la saturación |

### Variables de los escenarios

| Variable | Defecto | Aplica a |
| :-- | :-- | :-- |
| `BASE_URL` | `http://localhost:8080` | todos |
| `THINK_TIME` | `1.0` s (±20 %) | todos (se ignora en `MODE=rate`) |
| `REQ_TIMEOUT` | `5s` | todos |
| `THRESHOLDS` | `on` | todos. `off` desactiva los umbrales, que nunca abortan la prueba |
| `NEARBY_RADII` | `100:15,250:30,500:30,1000:18,2000:7` | nearby (radio en metros:peso) |
| `NEARBY_HOTSPOT_RATIO` / `NEARBY_SPARSE_RATIO` | `0.8` / `0.1` | nearby |
| `NEARBY_BODY_SAMPLE` | `0.1` | nearby (fracción de respuestas que se cuentan) |
| `WRITE_POST_RATIO` | `0.5` | write (POST vs PUT rating) |
| `ASYNC_PROBE_RATE` / `ASYNC_PROBE_TIMEOUT_S` | `0` / `15` | write |
| `AUTH_FAIL_RATIO` / `AUTH_LOGOUT` | `0.1` / `false` | auth |
| `GRAPHQL_MIX` | `dashboard:50,friendsPage:30,requests:20` | graphql |
| `MIX` | `nearby:50,graphql:20,write:20,auth:10` | mixed |
| `FLOW` | `mixed` | mixed (`nearby`, `write`, `auth` o `graphql` para aislar un flujo) |
| `SEED_MANIFEST` | `../.seed-manifest.json` | todos |
| `TOKEN_MIN_TTL` / `FORCE_TOKEN_REFRESH` | `300` / `false` | renovación de tokens en `setup()` |

Con `run-scenarios.sh`, estas variables se pasan con el prefijo `P7_`, por ejemplo `P7_MIX="nearby:80,auth:20" ./performance/run-scenarios.sh --flows mixed`.

---

## 5. Métricas que reportan

Usan **los mismos nombres** que `profiles/common.js`, así que `analyze_results.py` (Persona 8) las entiende sin cambios:

| Métrica | Tipo | Significado |
| :-- | :-- | :-- |
| `flow_nearby_duration`, `flow_write_duration`, `flow_auth_duration`, `flow_graphql_duration` | Trend (ms) | Latencia por flujo |
| `flow_*_reqs` | Counter | Peticiones por flujo |
| `real_error_rate`, `http_5xx_or_timeout` | Rate / Counter | Errores de capacidad: timeout, 408, 5xx |
| `rate_limited_rate`, `http_429_responses` | Rate / Counter | Rechazos por rate limiting (Escenario 4), no son saturación |

Métricas adicionales de la Persona 7:

| Métrica | Significado |
| :-- | :-- |
| `nearby_results_count`, `nearby_payload_bytes` (tag `radius`) | Cuántos mensajes y cuántos bytes devuelve `/nearby`. Explica por qué crece la latencia |
| `write_post_message_duration`, `write_put_rating_duration` | Separa las dos escrituras del Flujo 2 |
| `message_publish_latency`, `message_publish_timeouts` | Latencia del pipeline asíncrono de moderación |
| `auth_login_ok_duration`, `auth_login_rejected_duration` | Login correcto vs rechazado |
| `graphql_error_rate` | Respuestas `200` con `errors` de GraphQL |
| `unexpected_status_rate` | Respuestas 4xx no esperadas, que indican un problema de datos o contrato y no de capacidad |
| `token_refreshes` | Sesiones renovadas durante la prueba |

Además, cada petición lleva los tags `flow` y `name` (y `radius`, `zone`, `operation` y `outcome` según el flujo) para filtrar `metrics.csv.gz` o el reporte HTML.

---

## 6. Estructura

```
performance/
├── README.md                 ← este archivo (Persona 7)
├── README-P8.md              ← suite de ejecución y análisis (Persona 8)
├── package.json              ← "type": "module" + atajos npm (sin dependencias)
├── seed-data.mjs             ← seeder
├── run-scenarios.sh          ← runner por flujo (JSON / CSV / HTML)
├── scenarios/
│   ├── nearby.js  write.js  auth.js  graphql.js  mixed.js
│   └── lib/
│       ├── geo-data.js       ← hotspots y contenido (compartido Node + k6)
│       ├── workload.js       ← sesiones, métricas, options, utilidades
│       └── flows.js          ← implementación de los 4 flujos
├── tools/summarize-results.mjs
├── profiles/                 ← Persona 8: load / stress / spike + common.js + seed-fallback
├── run-performance-suite.sh  collect-metrics.sh  analyze_results.py  validate_pipeline.py
└── results/
```

---

## 7. Limpieza

```bash
node performance/seed-data.mjs --clean-bulk     # quita los 20.000 mensajes de volumen
docker compose down -v                          # o borra todos los datos del stack
```

Los usuarios `perf_user_*` y sus mensajes calificables se reutilizan entre corridas, así que no hace falta borrarlos.
