# Escenario de seguridad 4 — Rate Limiting / Throttling Pattern

> Sección para integrar en `p3_2F.md` → *Quality Attributes › Security*.
> Las cifras de la sección 5 provienen de `scripts/test-rate-limit.mjs` en los
> modos `vulnerable` y `protected` (salidas completas en [`evidencia/`](./evidencia/)).

## 1. Problema arquitectónico

En el Prototipo 2 el API Gateway (Spring Cloud Gateway) enruta toda petición
válida hacia los microservicios sin controlar **cuántas** peticiones envía cada
cliente. Cualquier cliente, autenticado o no, puede mandar ráfagas ilimitadas
contra los endpoints más costosos del sistema:

| Endpoint | Costo en el backend | Abuso posible |
| :--- | :--- | :--- |
| `POST /api/auth/login` | Verificación **Argon2** (CPU y memoria intensiva) en `auth` + consulta a `auth-db` | Fuerza bruta / *credential stuffing* contra una cuenta; bloqueo intencional de la cuenta de la víctima |
| `POST /api/auth/register` | Hash Argon2 + escritura en `auth-db` + evento en RabbitMQ (perfil, red, email) | Creación masiva de cuentas falsas (bots, spam) |
| `POST /api/messages` | Escritura en PostGIS + evento en RabbitMQ + moderación + notificación en tiempo real | Spam que satura la base, el broker y la moderación |
| `PUT/DELETE /api/ratings/messages/:id` | Escritura en `rating-db` + evento a `reputation` | Manipulación masiva de la reputación |
| `GET /api/messages/nearby` | Consulta espacial PostGIS (`ST_DWithin`); es **pública** y **no limita el radio** | Agotamiento de recursos (DoS) en la base de mensajes |

Como el gateway es el único punto de entrada hacia los microservicios, cada
petición abusiva consume CPU, conexiones de base de datos y mensajes del broker
en varios servicios, y degrada el sistema para todos los usuarios legítimos.

**La defensa existente en `auth` no es suficiente.** El servicio de
autenticación ya bloquea una cuenta durante 15 min tras 5 intentos fallidos
(`423 Locked`), pero tiene dos debilidades:

1. **No resiste ráfagas concurrentes.** El estado de bloqueo se lee *antes* de
   verificar la contraseña y el contador se actualiza *después*
   (lectura-modificación-escritura no atómica). Si llegan 30 intentos a la vez,
   muchos leen la cuenta como "desbloqueada" al mismo tiempo. En las pruebas se
   verificaron **14 y 24 contraseñas** en dos ráfagas, aunque el máximo
   configurado es 5.
2. **Se puede usar contra la víctima.** Basta con enviar 5 contraseñas falsas
   para dejar al usuario legítimo sin acceso durante 15 min. Además, el bloqueo
   es por cuenta: no frena a un atacante que prueba una contraseña común contra
   muchas cuentas (*password spraying*).

La contramedida se ubica en el gateway, antes de llegar a `auth`, y limita por
**origen** (IP o usuario), no por cuenta atacada.

## 2. Escenario de calidad de seguridad

| Parte | Descripción |
| :--- | :--- |
| **Fuente** | Atacante externo, anónimo (fuerza bruta en login/registro, consultas `nearby`) o autenticado con una cuenta propia (spam de mensajes y calificaciones), que usa un script o bot desde una IP. |
| **Estímulo** | Ráfaga de peticiones concurrentes que supera el uso normal: p. ej. 30 intentos de login con contraseñas distintas, 30 publicaciones simultáneas o 150 consultas geoespaciales en menos de un segundo. |
| **Artefacto** | API Gateway (`gateway`) y los servicios que protege: `auth`, `messages` (PostGIS) y `rating`. |
| **Entorno** | Sistema en operación normal, desplegado con `docker compose`, con otros usuarios legítimos usándolo al mismo tiempo. |
| **Respuesta** | El gateway identifica al cliente (IP o usuario del JWT), consume una ficha de su *token bucket* en Redis y, al agotarse la cuota, **rechaza el exceso con `429 Too Many Requests`** junto con `Retry-After`, `X-RateLimit-Limit` y `X-RateLimit-Remaining`, **sin reenviar la petición al microservicio**. Los demás clientes siguen recibiendo servicio con normalidad. |
| **Medida de la respuesta** | (1) Login/registro: como máximo **10 peticiones por minuto por IP**; desde la 11.ª el cliente recibe 429. (2) Publicar: como máximo **10 mensajes seguidos por usuario**, y luego 20 por minuto. (3) `nearby`: ráfaga de **60** y luego **30 por segundo por IP**. (4) El 100 % de las peticiones que superan la cuota se rechaza en el gateway sin llegar al microservicio. En login, el 429 responde con p95 de **62 ms**, frente a 657 ms de un intento que sí llega a `auth`. (5) Durante el ataque, otro usuario sigue publicando (201) y las lecturas siguen respondiendo (200). (6) Un diccionario de 10 000 contraseñas desde una IP pasa de **~8 min** sin límite a **~16,7 h** con límite (×125). |

## 3. Tácticas de seguridad aplicadas

| Categoría (Bass, Clements y Kazman) | Táctica | Cómo se aplica en GeoPicto |
| :--- | :--- | :--- |
| **Detectar ataques** | *Detect Service Denial* | El gateway cuenta las peticiones de cada cliente en una ventana de tiempo (token bucket) y detecta cuando el ritmo supera la política de la ruta. |
| **Resistir ataques** | *Limit Access* | Cuando se supera la cuota, se deniega el acceso al recurso (429) hasta que el balde se rellene. |
| **Resistir ataques** | *Limit Exposure* | Las peticiones rechazadas se cortan en el borde y nunca llegan a `auth`, `messages`, `rating`, PostGIS ni RabbitMQ. Así se reduce la superficie que un atacante puede hacer trabajar. |
| **Reaccionar a ataques** | *Inform Actors* | La respuesta 429 informa al cliente con `Retry-After` cuándo puede reintentar, y con `X-RateLimit-Remaining` cuántas peticiones le quedan. |
| **Recuperarse de ataques** *(disponibilidad)* | *Degradación controlada* | Si Redis no responde, el limitador aplica **fail-open** (deja pasar el tráfico) para no convertir una falla de Redis en una caída total. Es configurable a **fail-closed** (503) con `RATE_LIMIT_FAIL_OPEN=false`. |

## 4. Patrón arquitectónico aplicado: Rate Limiting / Throttling

### 4.1 Elementos y relaciones

| Elemento | Responsabilidad |
| :--- | :--- |
| `RateLimitGatewayFilterFactory` (gateway) | Filtro de ruta `RateLimit=<política>`. Arma la clave del cliente, consulta el limitador y responde 429 o deja pasar la petición. |
| `ClientIpResolver` (gateway) | Obtiene la IP del cliente. Solo confía en `X-Real-IP` / `X-Forwarded-For` cuando `RATE_LIMIT_TRUST_PROXY=true`, es decir, cuando el gateway queda detrás del Reverse Proxy. |
| `RedisTokenBucketLimiter` + `token_bucket.lua` | Implementa el *token bucket* como un **script Lua atómico en Redis**: lee el balde, lo rellena según el tiempo transcurrido (reloj de Redis), consume una ficha y fija un TTL. |
| `redis` (base 1) | Almacén compartido de los baldes (`rl:<política>:<ip\|user>:<id>`). Se separa de la base 0, que usa `socket-gateway`. |
| `application.yml` (`rate-limit.policies`) | Políticas declarativas por ruta, todas parametrizables con variables de entorno. |

**Conector nuevo:** `gateway → redis` (RESP/TCP) en las vistas C&C, de capas y de despliegue
(ver `docs/diagrams/p3/`).

### 4.2 Flujo de una petición

```
Cliente ──► Gateway ──► [JwtAuth]* ──► [RateLimit=<política>] ──► Microservicio
                                            │  EVALSHA token_bucket.lua
                                            ▼
                                          Redis ──► {permitido, restantes, ms para reintentar}
                                            │
                     cuota agotada ◄────────┘──► 429 + Retry-After (no llega al microservicio)
```

\* En las rutas autenticadas, `RateLimit` va **después** de `JwtAuth`. Así la
clave por usuario sale del `X-User-ID` derivado de un JWT válido, y un token
inválido se rechaza con 401 sin consumir cuota.

### 4.3 Políticas por criticidad de ruta

| Política | Rutas | Clave | Capacidad (ráfaga) | Recarga | Criticidad |
| :--- | :--- | :--- | ---: | :--- | :--- |
| `auth` | `POST /api/auth/login`, `POST /api/auth/register` | IP | 10 | 10 / min | **Estricta**: fuerza bruta y spam de cuentas |
| `message-write` | `POST /api/messages` | Usuario (`sub`) | 10 | 20 / min | **Moderada**: escritura + broker + moderación |
| `rating-write` | `PUT`, `DELETE /api/ratings/messages/*` | Usuario (`sub`) | 30 | 60 / min | **Moderada**: escritura + reputación |
| `nearby` | `GET /api/messages/nearby` | IP | 60 | 30 / s | **Amplia**: lectura pública frecuente |

Las demás rutas (lecturas autenticadas, GraphQL, perfiles, WebSocket) no se
limitan en este prototipo, para no afectar la experiencia normal del usuario.

### 4.4 Decisiones de diseño

- **Token bucket en lugar de ventana fija:** permite ráfagas cortas legítimas,
  como abrir la app y cargar varias cosas a la vez, mientras impone un ritmo
  sostenido. Además evita el doble pico que permite una ventana fija en el
  borde entre dos ventanas.
- **Estado en Redis con script Lua atómico:** si se escala el gateway a varias
  réplicas, todas comparten el mismo balde sin condiciones de carrera. El reloj
  es el de Redis, así que no depende de que los relojes de las réplicas estén
  sincronizados.
- **Límite en el gateway y no en cada microservicio:** el control queda en un
  solo lugar (los servicios están escritos en Python, Go, Node y Java) y el
  tráfico abusivo se corta antes de consumir recursos internos.
- **Clave por usuario en las mutaciones:** varios usuarios legítimos detrás de
  la misma IP (p. ej. la red de la universidad) no comparten cuota de escritura.

## 5. Evidencia: antes vs. después

La contramedida se activa o desactiva con una sola variable, sin cambiar código:

```bash
# Versión VULNERABLE (sin la contramedida)
RATE_LIMIT_ENABLED=false docker compose up -d gateway
node scripts/test-rate-limit.mjs --mode vulnerable --json performance/results/rate-limit-vulnerable.json

# Versión PROTEGIDA (con Rate Limiting)
RATE_LIMIT_ENABLED=true docker compose up -d gateway
node scripts/test-rate-limit.mjs --mode protected --json performance/results/rate-limit-protected.json
```

| Ataque | Métrica | Sin Rate Limiting | Con Rate Limiting |
| :--- | :--- | ---: | ---: |
| 1. 30 `POST /api/messages` del mismo usuario | Peticiones que llegan a `messages` | **30 / 30** | **10 / 30** |
| | Respuestas 429 | 0 | 20 |
| | Mensajes de spam guardados | 30 | 10 (= capacidad de la política) |
| 2. 30 logins con contraseña incorrecta | Peticiones que llegan a `auth` | **30 / 30** (14 × 401, 16 × 423) | **8 / 30** (2 de las 10 fichas se usaron en los registros) |
| | Contraseñas verificadas con Argon2 | 14 (el bloqueo por cuenta permite 5) | 8 |
| | Respuestas 429 | 0 | 22 |
| | Latencia p50 / p95 | 1 412 / 1 432 ms (todas en `auth`) | 429: **46 / 62 ms** · en `auth`: 517 / 657 ms |
| | Diccionario de 10 000 contraseñas desde una IP | ~8 min (20,9 intentos/s) | ~16,7 h (10 intentos/min) |
| 3. 150 `GET /api/messages/nearby` (radio 5 km) | Consultas que llegan a PostGIS | **150 / 150** | **76 / 150** (60 de ráfaga + ~17 recargadas en 589 ms) |
| | Respuestas 429 | 0 | 74 |
| Usuario legítimo durante el ataque | `POST /api/messages` (antes y después de la ráfaga de lecturas) | 201 | 201 |
| Lecturas tras los ataques | `GET /api/messages/nearby` | 200 | 200 |

Mediciones del 22-nov-2026, sistema completo en `docker compose` en una sola
máquina, con ráfagas concurrentes desde Node.js. Las salidas están en
`evidencia/rate-limit-vulnerable.*` y `evidencia/rate-limit-protected.*`.

**Interpretación:**

- **Sin la contramedida, el 100 % del tráfico abusivo llega a los
  microservicios.** El spam se guarda completo, cada intento de login consume
  una verificación Argon2 y las 150 consultas espaciales se ejecutan en PostGIS.
  La latencia de login en la ráfaga (p50 ≈ 1,4 s) muestra que `auth` se satura
  con la CPU de Argon2. Un atacante con una sola IP prueba ~21 contraseñas por
  segundo.
- **Con la contramedida, el número de peticiones que llega al backend coincide
  exactamente con la política configurada**: 10 publicaciones, 8 logins (10 menos
  2 registros) y 60 + recarga en `nearby`. Todo el exceso se corta en el gateway.
- **El rechazo es barato:** un 429 de login cuesta ~46 ms, frente a ~517 ms de
  una verificación en `auth`. El gateway rechaza el abuso sin trasladar el costo
  al servicio.
- **Las cuotas son independientes por cliente y por política.** El usuario
  legítimo publica (201) mientras el atacante está limitado, y la ráfaga de
  lecturas de una IP no bloquea las escrituras de otro usuario.
- **Complementa la defensa de `auth`.** Con el límite activo, la ráfaga ya no
  alcanza a disparar el bloqueo de la cuenta (0 respuestas 423): la víctima no
  queda bloqueada por el ataque, y la condición de carrera queda acotada a la
  cuota de la IP.

> **Nota sobre las latencias de los 429 en los ataques 1 y 3:** las ráfagas de
> 30 y 150 peticiones simultáneas hacen cola en el cliente y en el event loop del
> gateway. Por eso los 429 de esos ataques muestran latencias de 400–550 ms, que
> no son representativas del costo del rechazo. La medida limpia es la de login.
> En la salida del script, "primera petición bloqueada" se refiere al orden de
> envío; como las peticiones son concurrentes, el orden de llegada varía, y la
> métrica significativa es cuántas peticiones pasan.

## 6. Compromisos (trade-offs) y riesgos

- **Latencia:** cada petición limitada hace un viaje extra a Redis (un `EVALSHA`).
  El tiempo de espera está acotado a 500 ms (`redis-timeout`).
- **Fail-open vs. fail-closed:** por defecto se prioriza la disponibilidad. Si
  Redis cae, el sistema queda temporalmente sin protección contra ráfagas.
- **Identificación por IP detrás del Reverse Proxy:** con el proxy de los
  escenarios 1 y 2, todas las conexiones llegan desde la IP del Nginx. Por eso
  hay que activar `RATE_LIMIT_TRUST_PROXY=true`; si no, todos los usuarios
  compartirían una sola cuota de login. Esa opción solo debe activarse si el
  gateway **no** es accesible directamente, porque si no un atacante podría
  falsificar su IP con `X-Forwarded-For`.
- **Ataques distribuidos (DDoS desde muchas IP):** el límite por IP los mitiga
  solo en parte. Requieren medidas de red adicionales, fuera del alcance de este
  prototipo.
- **Pruebas de rendimiento:** con la contramedida activa, las pruebas de carga
  reciben 429 por diseño. El análisis de rendimiento debe ejecutarse con
  `RATE_LIMIT_ENABLED=false`, o reportar ese efecto de forma explícita.
