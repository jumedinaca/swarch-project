/**
 * GeoPicto — Librería de workload para k6 (Persona 7)
 *
 * Base común de los escenarios de performance/scenarios/*.js:
 *   - Carga del manifest de seed-data.mjs en memoria compartida (SharedArray),
 *     de modo que 2000 VUs no dupliquen el JSON.
 *   - Gestión de sesiones: un VU = un usuario; renueva tokens vencidos
 *     (el access token dura 15 min) en setup() y, si aun así llega un 401,
 *     vuelve a iniciar sesión y reintenta una vez.
 *   - Generación de coordenadas sobre los mismos hotspots que se sembraron.
 *   - Métricas con los MISMOS nombres que profiles/common.js (Persona 8), para
 *     que run-performance-suite.sh / analyze_results.py procesen estos
 *     escenarios sin cambios, más métricas extra propias de cada flujo.
 *   - Constructor de options con 3 modos: single | stages | rate.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import encoding from 'k6/encoding';
import { Counter, Rate, Trend } from 'k6/metrics';

import { HOTSPOTS, BACKGROUND_BBOX, SPARSE_POINTS, PLACES, MESSAGE_TEMPLATES } from './geo-data.js';

// ---------------------------------------------------------------------------
// Configuración por variables de entorno (mismo contrato que Persona 8)
// ---------------------------------------------------------------------------

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
export const FLOW_MODE = (__ENV.FLOW || 'mixed').toLowerCase();
export const REQ_TIMEOUT = __ENV.REQ_TIMEOUT || '5s';
export const THINK_TIME = Number.parseFloat(__ENV.THINK_TIME ?? '1.0');
export const INSECURE_TLS = (__ENV.INSECURE_TLS || 'true').toLowerCase() !== 'false';
export const SUMMARY_TREND_STATS = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'];

const num = (v, def) => {
  const n = Number.parseFloat(v ?? '');
  return Number.isFinite(n) ? n : def;
};

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------

// Compartidas con profiles/common.js (k6 reutiliza la métrica si nombre y tipo coinciden)
export const flowNearbyDuration = new Trend('flow_nearby_duration', true);
export const flowWriteDuration = new Trend('flow_write_duration', true);
export const flowAuthDuration = new Trend('flow_auth_duration', true);
export const flowGraphqlDuration = new Trend('flow_graphql_duration', true);
export const flowNearbyReqs = new Counter('flow_nearby_reqs');
export const flowWriteReqs = new Counter('flow_write_reqs');
export const flowAuthReqs = new Counter('flow_auth_reqs');
export const flowGraphqlReqs = new Counter('flow_graphql_reqs');
export const http429Responses = new Counter('http_429_responses');
export const http5xxOrTimeout = new Counter('http_5xx_or_timeout');
export const realErrorRate = new Rate('real_error_rate');
export const rateLimitedRate = new Rate('rate_limited_rate');

// Propias de la Persona 7
export const nearbyResults = new Trend('nearby_results_count');
export const nearbyPayloadBytes = new Trend('nearby_payload_bytes');
export const writePostDuration = new Trend('write_post_message_duration', true);
export const writeRatingDuration = new Trend('write_put_rating_duration', true);
export const messagePublishLatency = new Trend('message_publish_latency', true);
export const messagePublishTimeouts = new Counter('message_publish_timeouts');
export const authOkDuration = new Trend('auth_login_ok_duration', true);
export const authRejectedDuration = new Trend('auth_login_rejected_duration', true);
export const graphqlErrorRate = new Rate('graphql_error_rate');
export const tokenRefreshes = new Counter('token_refreshes');
export const unexpectedStatusRate = new Rate('unexpected_status_rate');

// ---------------------------------------------------------------------------
// Datos sembrados (SharedArray: una sola copia en memoria para todos los VUs)
// ---------------------------------------------------------------------------

const MANIFEST_CANDIDATES = [
  __ENV.SEED_MANIFEST,
  '../.seed-manifest.json', // relativo a scenarios/<script>.js
  '../../.seed-manifest.json', // relativo a scenarios/lib/ (según versión de k6)
].filter(Boolean);

function loadManifest() {
  for (const candidate of MANIFEST_CANDIDATES) {
    try {
      const parsed = JSON.parse(open(candidate));
      if (parsed && Array.isArray(parsed.users)) return parsed;
    } catch (_) {
      // siguiente candidato
    }
  }
  return { users: [], messages: [] };
}

export const USERS = new SharedArray('seed-users', () =>
  loadManifest().users.map((u) => ({
    id: u.id,
    email: u.email,
    username: u.username,
    password: u.password,
    token: u.token,
  }))
);

export const MESSAGES = new SharedArray('seed-messages', () =>
  (loadManifest().messages || []).map((m) => ({ id: m.id, authorId: m.authorId }))
);

export function requireSeed(flowName) {
  if (USERS.length === 0) {
    throw new Error(
      `[${flowName}] No hay usuarios sembrados. Ejecuta primero 'node performance/seed-data.mjs' ` +
        '(o pasa -e SEED_MANIFEST=/ruta/a/.seed-manifest.json).'
    );
  }
}

// ---------------------------------------------------------------------------
// Sesiones y tokens
// ---------------------------------------------------------------------------

function jwtExp(token) {
  try {
    const payload = JSON.parse(encoding.b64decode(token.split('.')[1], 'rawurl', 's'));
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch (_) {
    return 0;
  }
}

function loginRequest(user, password, tags) {
  return http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ usernameOrEmail: user.email, password }),
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: REQ_TIMEOUT,
      tags,
      responseCallback: http.expectedStatuses(200, 401),
    }
  );
}

function tokenFrom(res) {
  try {
    return res.json('data.token') || null;
  } catch (_) {
    return null;
  }
}

/**
 * Para usar en setup(): si algún token del manifest vence antes de
 * TOKEN_MIN_TTL segundos (por defecto 300), inicia sesión con todos los
 * usuarios en lotes y devuelve los tokens nuevos. Si no hace falta, devuelve
 * {} y no genera tráfico extra.
 */
export function refreshTokensIfNeeded() {
  if (USERS.length === 0) return { tokens: {} };
  const minTtl = num(__ENV.TOKEN_MIN_TTL, 300);
  const now = Math.floor(Date.now() / 1000);
  // SharedArray solo admite length, índice y for-of (no map/slice)
  const all = [];
  for (const u of USERS) all.push(u);
  const soonest = Math.min(...all.map((u) => jwtExp(u.token)));
  if (soonest - now > minTtl && __ENV.FORCE_TOKEN_REFRESH !== 'true') {
    return { tokens: {} };
  }

  console.log(`[setup] Tokens del manifest vencen en ${soonest - now}s; renovando ${all.length} sesiones...`);
  const tokens = {};
  const BATCH = 20;
  for (let i = 0; i < all.length; i += BATCH) {
    const chunk = all.slice(i, i + BATCH);
    const responses = http.batch(
      chunk.map((u) => ({
        method: 'POST',
        url: `${BASE_URL}/api/auth/login`,
        body: JSON.stringify({ usernameOrEmail: u.email, password: u.password }),
        params: {
          headers: { 'Content-Type': 'application/json' },
          timeout: '30s',
          tags: { flow: 'setup_token_refresh', name: 'setup: POST /api/auth/login' },
        },
      }))
    );
    responses.forEach((res, idx) => {
      const t = tokenFrom(res);
      if (t) tokens[chunk[idx].id] = t;
    });
  }
  console.log(`[setup] Sesiones renovadas: ${Object.keys(tokens).length}/${all.length}`);
  return { tokens };
}

// Estado por VU (cada VU tiene su propio contexto JS)
const vuTokens = {};

/** Usuario fijo del VU actual: un VU simula a una persona con su sesión. */
export function currentUser() {
  return USERS[(__VU - 1) % USERS.length];
}

function tokenFor(user, data) {
  return vuTokens[user.id] || (data && data.tokens && data.tokens[user.id]) || user.token;
}

function relogin(user) {
  const res = loginRequest(user, user.password, { flow: 'token_refresh', name: 'refresh: POST /api/auth/login' });
  const t = res.status === 200 ? tokenFrom(res) : null;
  if (t) {
    vuTokens[user.id] = t;
    tokenRefreshes.add(1);
  }
  return t;
}

/**
 * Ejecuta una petición autenticada. Si responde 401 (token vencido), renueva la
 * sesión del usuario y la repite una vez. Solo se devuelve la respuesta final.
 */
export function withAuth(user, data, doRequest) {
  let res = doRequest(tokenFor(user, data));
  if (res.status === 401) {
    const fresh = relogin(user);
    if (fresh) res = doRequest(fresh);
  }
  return res;
}

export function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Registro de resultados (misma semántica que Persona 8)
// ---------------------------------------------------------------------------

/**
 * - 429 se cuenta aparte (rate limiting del Escenario 4, no es saturación).
 * - 0 (timeout/conexión), 408 y 5xx son errores reales de capacidad.
 * - Cualquier otro estado no esperado va a unexpected_status_rate.
 */
export function recordOutcome(res, flowTrend, flowCounter, expectedStatuses, label) {
  const is429 = res.status === 429;
  const isRealErr = res.status === 0 || res.status === 408 || res.status >= 500;
  const expected = expectedStatuses.indexOf(res.status) !== -1;

  flowTrend.add(res.timings.duration);
  flowCounter.add(1);
  rateLimitedRate.add(is429);
  realErrorRate.add(isRealErr);
  unexpectedStatusRate.add(!expected && !is429 && !isRealErr);
  if (is429) http429Responses.add(1);
  if (isRealErr) http5xxOrTimeout.add(1);

  check(res, {
    [`${label}: status esperado (${expectedStatuses.join('/')}) o 429`]: (r) => expected || r.status === 429,
    [`${label}: sin 5xx ni timeout`]: () => !isRealErr,
  });
  return expected;
}

/** Parámetros comunes de una petición. 429 se marca "esperado" para no inflar http_req_failed. */
export function params(flow, name, extra = {}) {
  const { expected = [200], ...rest } = extra;
  return {
    timeout: REQ_TIMEOUT,
    tags: { flow, name },
    responseCallback: http.expectedStatuses(...expected, 429),
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// Aleatoriedad geográfica y de contenido
// ---------------------------------------------------------------------------

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function gaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function weightedHotspot() {
  const total = HOTSPOTS.reduce((s, h) => s + h.weight, 0);
  let r = Math.random() * total;
  for (const h of HOTSPOTS) {
    r -= h.weight;
    if (r <= 0) return h;
  }
  return HOTSPOTS[0];
}

export function pointNear(h, spreadFactor = 1) {
  const sigma = h.sigmaM * spreadFactor;
  const dLat = (gaussian() * sigma) / 111320;
  const dLng = (gaussian() * sigma) / (111320 * Math.cos((h.lat * Math.PI) / 180));
  return { lat: +(h.lat + dLat).toFixed(6), lng: +(h.lng + dLng).toFixed(6), zone: h.id };
}

/**
 * Ubicación desde la que un usuario consulta el mapa:
 *   NEARBY_HOTSPOT_RATIO (0.8) cerca de un hotspot, NEARBY_SPARSE_RATIO (0.1)
 *   en una zona sin actividad y el resto uniforme por la ciudad.
 */
export function queryPoint() {
  const r = Math.random();
  const hotRatio = num(__ENV.NEARBY_HOTSPOT_RATIO, 0.8);
  const sparseRatio = num(__ENV.NEARBY_SPARSE_RATIO, 0.1);
  if (r < hotRatio) return pointNear(weightedHotspot());
  if (r < hotRatio + sparseRatio) return pointNear({ ...pick(SPARSE_POINTS), sigmaM: 300 });
  const b = BACKGROUND_BBOX;
  return {
    lat: +(b.minLat + Math.random() * (b.maxLat - b.minLat)).toFixed(6),
    lng: +(b.minLng + Math.random() * (b.maxLng - b.minLng)).toFixed(6),
    zone: 'background',
  };
}

/** Hotspot "de residencia" estable por VU, para que publique cerca de donde vive. */
export function homeHotspot() {
  return HOTSPOTS[(__VU - 1) % HOTSPOTS.length];
}

export function messageContent(zone) {
  const place = PLACES[zone] ? pick(PLACES[zone]) : 'por aquí';
  return pick(MESSAGE_TEMPLATES).replace('{place}', place);
}

/**
 * Lista ponderada "250:30,500:30,1000:20" -> elección aleatoria.
 * Devuelve el valor como string (se usa también como tag).
 */
export function weightedChoice(spec) {
  const entries = String(spec)
    .split(',')
    .map((part) => part.split(':'))
    .map(([v, w]) => ({ v: v.trim(), w: num(w, 1) }))
    .filter((e) => e.v);
  const total = entries.reduce((s, e) => s + e.w, 0);
  let r = Math.random() * total;
  for (const e of entries) {
    r -= e.w;
    if (r <= 0) return e.v;
  }
  return entries[entries.length - 1].v;
}

export function thinkTime() {
  // En modo abierto (MODE=rate) el ritmo lo fija el executor, no el VU
  if (THINK_TIME > 0 && (__ENV.MODE || '').toLowerCase() !== 'rate') {
    // ±20 % de jitter para no alinear artificialmente miles de VUs
    sleep(THINK_TIME * (0.8 + Math.random() * 0.4));
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

function parseStages(spec) {
  // "30s:25,1m:50,30s:0" -> [{duration:'30s', target:25}, ...]
  return String(spec)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [duration, target] = s.split(':');
      return { duration: duration.trim(), target: Number.parseInt(target, 10) };
    });
}

/**
 * Modos (variable MODE):
 *   single -> VUS usuarios constantes durante DURATION (lo usa run-performance-suite.sh)
 *   stages -> rampa de VUs (STAGES="30s:25,1m:50,30s:0" o la del escenario)
 *   rate   -> modelo abierto: RATE iteraciones/s constantes durante DURATION
 *             (PRE_VUS / MAX_VUS). Mide latencia sin el sesgo del modelo cerrado.
 *
 * THRESHOLDS=off desactiva los umbrales (los umbrales nunca abortan la prueba).
 */
export function buildOptions({ defaultMode = 'stages', defaultStages, thresholds = {} }) {
  const mode = (__ENV.MODE || defaultMode).toLowerCase();
  const duration = __ENV.DURATION || '1m';

  const base = {
    insecureSkipTLSVerify: INSECURE_TLS,
    summaryTrendStats: SUMMARY_TREND_STATS,
    userAgent: 'GeoPicto-k6-Scenarios/P3',
    setupTimeout: '180s',
    tags: { suite: 'p7-scenarios', testid: __ENV.TEST_ID || 'local' },
  };

  if ((__ENV.THRESHOLDS || 'on').toLowerCase() !== 'off') {
    base.thresholds = {
      real_error_rate: [{ threshold: 'rate<0.01', abortOnFail: false }],
      ...Object.fromEntries(
        Object.entries(thresholds).map(([metric, exprs]) => [
          metric,
          exprs.map((threshold) => ({ threshold, abortOnFail: false })),
        ])
      ),
    };
  }

  if (mode === 'single') {
    return { ...base, vus: Number.parseInt(__ENV.VUS || '50', 10), duration };
  }

  if (mode === 'rate') {
    const rate = Number.parseInt(__ENV.RATE || '50', 10);
    return {
      ...base,
      scenarios: {
        open_model: {
          executor: 'constant-arrival-rate',
          rate,
          timeUnit: '1s',
          duration,
          preAllocatedVUs: Number.parseInt(__ENV.PRE_VUS || String(Math.max(10, rate)), 10),
          maxVUs: Number.parseInt(__ENV.MAX_VUS || String(Math.max(50, rate * 10)), 10),
        },
      },
    };
  }

  return { ...base, stages: __ENV.STAGES ? parseStages(__ENV.STAGES) : defaultStages };
}

export const DEFAULT_STAGES = [
  { duration: '30s', target: 25 },
  { duration: '1m', target: 50 },
  { duration: '1m', target: 100 },
  { duration: '30s', target: 0 },
];
