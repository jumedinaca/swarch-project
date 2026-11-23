#!/usr/bin/env node
/**
 * GeoPicto — Seeder de datos para pruebas de rendimiento (Persona 7)
 *
 * Puebla el sistema con un volumen realista para que los 4 flujos de carga
 * trabajen sobre datos reales y no sobre tablas vacías:
 *
 *   1. Usuarios de prueba (auth-service, Argon2id)            -> vía API
 *   2. Grafo social: amistades aceptadas + solicitudes          -> vía GraphQL
 *      pendientes (network-service, MongoDB)
 *   3. Mensajes "vivos" que recorren TODO el pipeline:          -> vía API
 *      messages -> RabbitMQ -> moderation -> PUBLISHED -> rating (proyección)
 *      Son los únicos que se pueden calificar (Flujo 2).
 *   4. Mensajes de volumen para PostGIS (opcional, por defecto  -> SQL directo
 *      20.000) repartidos por Bogotá con zonas densas y zonas      en messages-db
 *      vacías, para que ST_DWithin trabaje con un índice GIST real.
 *
 * Es idempotente: si se vuelve a ejecutar reutiliza usuarios (409 -> login),
 * no duplica amistades y solo inserta los mensajes que falten.
 *
 * Salida: performance/.seed-manifest.json (mismo contrato que
 * profiles/seed-fallback.mjs de la Persona 8, más campos extra).
 *
 * Uso:
 *   node performance/seed-data.mjs
 *   BASE_URL=https://localhost node performance/seed-data.mjs
 *   node performance/seed-data.mjs --users 300 --messages 600 --bulk 50000
 *   node performance/seed-data.mjs --skip-bulk          # solo vía API
 *   node performance/seed-data.mjs --clean-bulk         # solo borra el volumen SQL y sale
 *
 * Variables de entorno (los flags tienen prioridad):
 *   BASE_URL               (auto: https://localhost y luego http://localhost:8080)
 *   SEED_USERS=200         SEED_MESSAGES=400        SEED_BULK_MESSAGES=20000
 *   SEED_FRIENDS=6         SEED_PENDING=2           SEED_CONCURRENCY=8
 *   SEED_PASSWORD          SEED_MANIFEST            SEED_RANDOM_SEED=42
 *   COMPOSE_PROJECT=geopicto   MESSAGES_DB_CONTAINER (autodetectado por label)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { HOTSPOTS, BACKGROUND_BBOX, MESSAGE_TEMPLATES, PLACES } from './scenarios/lib/geo-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`Falta el valor de ${arg}`);
      i += 1;
      return v;
    };
    switch (arg) {
      case '--base-url': out.baseUrl = next(); break;
      case '--users': out.users = next(); break;
      case '--messages': out.messages = next(); break;
      case '--bulk': out.bulk = next(); break;
      case '--friends': out.friends = next(); break;
      case '--pending': out.pending = next(); break;
      case '--concurrency': out.concurrency = next(); break;
      case '--skip-bulk': out.bulk = '0'; break;
      case '--clean-bulk': out.cleanBulk = true; break;
      case '-h':
      case '--help': out.help = true; break;
      default: throw new Error(`Opción desconocida: ${arg}`);
    }
  }
  return out;
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`[seed] ${err.message}`);
  process.exit(2);
}

if (args.help) {
  const header = fs.readFileSync(fileURLToPath(import.meta.url), 'utf-8').split('*/')[0];
  console.log(header.replace(/^#!.*\n/, '').replace(/^\s?\/?\*\*?\s?/gm, ''));
  process.exit(0);
}

const int = (v, def, min = 0) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.max(min, n) : def;
};

const CFG = {
  baseUrl: (args.baseUrl || process.env.BASE_URL || '').replace(/\/+$/, ''),
  users: int(args.users ?? process.env.SEED_USERS, 200, 4),
  messages: int(args.messages ?? process.env.SEED_MESSAGES, 400, 10),
  bulk: int(args.bulk ?? process.env.SEED_BULK_MESSAGES, 20000, 0),
  friends: int(args.friends ?? process.env.SEED_FRIENDS, 6, 0),
  pending: int(args.pending ?? process.env.SEED_PENDING, 2, 0),
  concurrency: int(args.concurrency ?? process.env.SEED_CONCURRENCY, 8, 1),
  password: process.env.SEED_PASSWORD || 'PerfTest123!',
  manifest: process.env.SEED_MANIFEST || path.resolve(__dirname, '.seed-manifest.json'),
  randomSeed: int(process.env.SEED_RANDOM_SEED, 42),
  project: process.env.COMPOSE_PROJECT || process.env.PROJECT || 'geopicto',
  dbContainer: process.env.MESSAGES_DB_CONTAINER || '',
  cleanBulk: Boolean(args.cleanBulk),
  publishTimeoutMs: int(process.env.SEED_PUBLISH_TIMEOUT_MS, 90000, 5000),
};

const BULK_MARKER = 'perf-seed-bulk';

if (process.env.INSECURE_TLS !== 'false') {
  // Certificados autofirmados del Reverse Proxy de P3 (https://localhost)
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[seed]', ...a);
const warn = (...a) => console.warn('[seed] WARN:', ...a);

// PRNG determinista (mulberry32): mismo SEED_RANDOM_SEED -> mismos datos.
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(CFG.randomSeed);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

function gaussian() {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Punto aleatorio: 94 % alrededor de un hotspot (normal), 6 % fondo uniforme. */
function randomPoint() {
  const totalWeight = HOTSPOTS.reduce((s, h) => s + h.weight, 0);
  const bgWeight = 0.06;
  let r = rand() * (totalWeight + bgWeight);
  for (const h of HOTSPOTS) {
    r -= h.weight;
    if (r <= 0) {
      const dLat = (gaussian() * h.sigmaM) / 111320;
      const dLng = (gaussian() * h.sigmaM) / (111320 * Math.cos((h.lat * Math.PI) / 180));
      return { lat: +(h.lat + dLat).toFixed(6), lng: +(h.lng + dLng).toFixed(6), zone: h.id };
    }
  }
  const b = BACKGROUND_BBOX;
  return {
    lat: +(b.minLat + rand() * (b.maxLat - b.minLat)).toFixed(6),
    lng: +(b.minLng + rand() * (b.maxLng - b.minLng)).toFixed(6),
    zone: 'background',
  };
}

function randomContent(zone) {
  const place = PLACES[zone] ? pick(PLACES[zone]) : 'por aquí';
  return pick(MESSAGE_TEMPLATES).replace('{place}', place);
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

function progress(label, done, total) {
  if (done === total || done % Math.max(1, Math.floor(total / 10)) === 0) {
    log(`  ${label}: ${done}/${total}`);
  }
}

async function api(method, urlPath, { token, body, retries = 4, timeoutMs = 20000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(`${CFG.baseUrl}${urlPath}`, {
        method,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'GeoPicto-PerfSeeder/P3',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });

      // Rate limiting (Escenario 4) o saturación momentánea: reintentar con backoff
      if ((res.status === 429 || res.status === 502 || res.status === 503) && attempt < retries) {
        const retryAfter = Number.parseFloat(res.headers.get('retry-after') || '');
        const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * 2 ** attempt;
        await sleep(Math.min(Math.max(waitMs, 300), 15000));
        continue;
      }

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      return { status: res.status, data };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    }
  }
  throw new Error(`${method} ${urlPath} falló tras ${retries + 1} intentos: ${lastErr?.message}`);
}

async function graphql(token, query, variables = {}) {
  const res = await api('POST', '/api/network/graphql', { token, body: { query, variables } });
  return { status: res.status, data: res.data?.data ?? null, errors: res.data?.errors ?? null };
}

function decodeJwtExp(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Detección del destino
// ---------------------------------------------------------------------------

async function probe(url) {
  try {
    const res = await fetch(`${url}/api/messages/nearby?lat=4.6371&lng=-74.0834&radius=100`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 200 || res.status === 429;
  } catch {
    return false;
  }
}

async function resolveBaseUrl() {
  if (CFG.baseUrl) {
    if (!(await probe(CFG.baseUrl))) {
      throw new Error(`No se pudo alcanzar GeoPicto en ${CFG.baseUrl}. ¿Está levantado el stack?`);
    }
    return;
  }
  for (const candidate of ['https://localhost', 'http://localhost:8080']) {
    if (await probe(candidate)) {
      CFG.baseUrl = candidate;
      return;
    }
  }
  throw new Error(
    'No se encontró GeoPicto en https://localhost ni en http://localhost:8080. ' +
      "Levanta el stack con 'docker compose up --build -d --wait' o pasa --base-url."
  );
}

// ---------------------------------------------------------------------------
// 1. Usuarios
// ---------------------------------------------------------------------------

async function ensureUser(index) {
  const pad = String(index).padStart(3, '0');
  const username = `perf_user_${pad}`;
  const email = `${username}@perf.geopicto.org`;

  const reg = await api('POST', '/api/auth/register', {
    body: { username, email, password: CFG.password },
  });

  let auth = reg.status === 201 ? reg.data?.data : null;
  if (!auth) {
    // 409 -> ya existe; iniciar sesión para obtener un token nuevo
    const login = await api('POST', '/api/auth/login', {
      body: { usernameOrEmail: email, password: CFG.password },
    });
    if (login.status !== 200 || !login.data?.data?.token) {
      throw new Error(
        `No se pudo registrar ni iniciar sesión con ${username} (register=${reg.status}, login=${login.status}). ` +
          'Si el rate limiting está activo, siembra con RATE_LIMIT_ENABLED=false o con menos usuarios.'
      );
    }
    auth = login.data.data;
  }

  return {
    id: auth.user.id,
    username,
    email,
    password: CFG.password,
    token: auth.token,
    tokenExpiresAt: decodeJwtExp(auth.token),
  };
}

async function seedUsers() {
  log(`1/4 Usuarios: asegurando ${CFG.users} (concurrencia ${CFG.concurrency})...`);
  let done = 0;
  const indexes = Array.from({ length: CFG.users }, (_, i) => i + 1);
  const users = await mapPool(indexes, CFG.concurrency, async (i) => {
    const u = await ensureUser(i);
    done += 1;
    progress('usuarios', done, CFG.users);
    return u;
  });
  return users;
}

// ---------------------------------------------------------------------------
// 2. Grafo social
// ---------------------------------------------------------------------------

const SEND_REQUEST = 'mutation($id: UUID!) { sendFriendRequest(recipientId: $id) { id status } }';
const ACCEPT_REQUEST = 'mutation($id: ID!) { acceptFriendRequest(id: $id) { id status } }';

/**
 * Topología determinista tipo "small world": el usuario i es amigo de los
 * SEED_FRIENDS/2 siguientes en el anillo (grado ≈ SEED_FRIENDS) y además tiene
 * SEED_PENDING solicitudes salientes sin aceptar hacia usuarios más lejanos,
 * así las consultas friends / incomingRequests / outgoingRequests devuelven datos.
 */
function buildSocialEdges(n) {
  const half = Math.max(1, Math.floor(CFG.friends / 2));
  const friends = [];
  const pending = [];
  const seen = new Set();
  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

  if (CFG.friends > 0) {
    for (let i = 0; i < n; i += 1) {
      for (let k = 1; k <= half; k += 1) {
        const j = (i + k) % n;
        if (j === i || seen.has(key(i, j))) continue;
        seen.add(key(i, j));
        friends.push([i, j]);
      }
    }
  }
  // Desplazamientos justo después de los amigos del anillo, sin dar la vuelta
  // hasta los amigos "por detrás" (offsets >= n - half)
  for (let i = 0; i < n; i += 1) {
    for (let k = 1; k <= CFG.pending; k += 1) {
      const offset = half + k;
      if (offset >= n - half) continue;
      const j = (i + offset) % n;
      if (j === i || seen.has(key(i, j))) continue;
      seen.add(key(i, j));
      pending.push([i, j]);
    }
  }
  return { friends, pending };
}

async function seedSocialGraph(users) {
  const { friends, pending } = buildSocialEdges(users.length);
  log(`2/4 Grafo social: ${friends.length} amistades + ${pending.length} solicitudes pendientes...`);

  const stats = { accepted: 0, pendingSent: 0, alreadyExisted: 0, failed: 0 };
  let done = 0;
  const total = friends.length + pending.length;

  const edges = [
    ...friends.map(([a, b]) => ({ a, b, accept: true })),
    ...pending.map(([a, b]) => ({ a, b, accept: false })),
  ];

  await mapPool(edges, CFG.concurrency, async ({ a, b, accept }) => {
    const alice = users[a];
    const bob = users[b];
    try {
      const sent = await graphql(alice.token, SEND_REQUEST, { id: bob.id });
      const reqId = sent.data?.sendFriendRequest?.id;
      if (!reqId) {
        // Ya existe la relación (o solicitud inversa): idempotente
        stats.alreadyExisted += 1;
      } else if (accept) {
        const acc = await graphql(bob.token, ACCEPT_REQUEST, { id: reqId });
        if (acc.data?.acceptFriendRequest?.status === 'ACCEPTED') stats.accepted += 1;
        else stats.failed += 1;
      } else {
        stats.pendingSent += 1;
      }
    } catch (err) {
      stats.failed += 1;
      if (stats.failed <= 3) warn(`relación ${alice.username} -> ${bob.username}: ${err.message}`);
    }
    done += 1;
    progress('relaciones', done, total);
  });

  log(
    `  nuevas aceptadas=${stats.accepted}, nuevas pendientes=${stats.pendingSent}, ` +
      `ya existían=${stats.alreadyExisted}, fallidas=${stats.failed}`
  );
  return { friendships: friends.length, pendingRequests: pending.length, ...stats };
}

// ---------------------------------------------------------------------------
// 3. Mensajes por API (pipeline completo: moderación + RabbitMQ + rating)
// ---------------------------------------------------------------------------

/** ¿rating-service ya tiene la proyección del mensaje? (200 = se puede calificar) */
async function isRateable(m, users) {
  const reader = users.find((u) => u.id !== m.authorId);
  const res = await api('GET', `/api/ratings/messages/${m.id}`, { token: reader.token, retries: 1 });
  return res.status === 200;
}

/**
 * Reutiliza los mensajes calificables del manifest anterior (si apunta al mismo
 * destino) verificándolos en una sola pasada. No se buscan por /nearby porque
 * los mensajes de volumen SQL comparten autores y no son calificables.
 */
async function previousSeedMessages(users) {
  let prev;
  try {
    prev = JSON.parse(fs.readFileSync(CFG.manifest, 'utf-8'));
  } catch {
    return [];
  }
  if (prev?.baseUrl !== CFG.baseUrl || !Array.isArray(prev.messages)) return [];
  const ids = new Set(users.map((u) => u.id));
  const candidates = prev.messages.filter((m) => m?.id && ids.has(m.authorId));
  const checked = await mapPool(candidates, CFG.concurrency * 2, async (m) =>
    (await isRateable(m, users).catch(() => false)) ? m : null
  );
  return checked.filter(Boolean);
}

async function waitUntil(label, items, check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let pending = [...items];
  const ok = [];
  while (pending.length > 0 && Date.now() < deadline) {
    const results = await mapPool(pending, CFG.concurrency * 2, async (item) => ({
      item,
      ready: await check(item).catch(() => false),
    }));
    ok.push(...results.filter((r) => r.ready).map((r) => r.item));
    pending = results.filter((r) => !r.ready).map((r) => r.item);
    if (pending.length > 0) {
      log(`  ${label}: ${ok.length} listos, ${pending.length} en espera...`);
      await sleep(2000);
    }
  }
  if (pending.length > 0) warn(`${label}: ${pending.length} no quedaron listos a tiempo y se descartan.`);
  return ok;
}

async function seedApiMessages(users) {
  log(`3/4 Mensajes vía API (moderación + RabbitMQ + proyección de rating): objetivo ${CFG.messages}...`);
  const byUser = new Map(users.map((u) => [u.id, u]));

  const existing = (await previousSeedMessages(users)).slice(0, CFG.messages);
  log(`  reutilizados del manifest anterior (siguen calificables): ${existing.length}`);

  const needed = Math.max(0, CFG.messages - existing.length);
  const created = [];
  if (needed > 0) {
    let done = 0;
    let rejected = 0;
    const jobs = Array.from({ length: needed }, (_, i) => i);
    await mapPool(jobs, CFG.concurrency, async (i) => {
      const author = users[i % users.length];
      const p = randomPoint();
      const res = await api('POST', '/api/messages', {
        token: author.token,
        body: { content: randomContent(p.zone), latitude: p.lat, longitude: p.lng },
      });
      if (res.status === 201 && res.data?.id) {
        created.push({ id: res.data.id, authorId: author.id, lat: p.lat, lng: p.lng, zone: p.zone });
      } else {
        rejected += 1;
        if (rejected <= 3) warn(`POST /api/messages -> ${res.status} ${JSON.stringify(res.data)?.slice(0, 160)}`);
      }
      done += 1;
      progress('mensajes creados', done, needed);
    });
  }

  // a) Esperar a que la moderación los publique (PENDING -> PUBLISHED)
  const published = await waitUntil(
    'publicación',
    created,
    async (m) => {
      const res = await api('GET', `/api/messages/${m.id}`, { token: byUser.get(m.authorId).token, retries: 1 });
      if (res.status === 200 && res.data?.status && res.data.status !== 'PENDING') {
        m.status = res.data.status;
        return true;
      }
      return false;
    },
    CFG.publishTimeoutMs
  );
  const blocked = published.filter((m) => m.status !== 'PUBLISHED').length;
  if (blocked > 0) warn(`${blocked} mensajes no quedaron PUBLISHED (moderación los bloqueó).`);

  // b) Esperar a que rating-service consuma message.published.v1 (proyección)
  const projected = await waitUntil(
    'proyección en rating',
    published.filter((m) => m.status === 'PUBLISHED'),
    (m) => isRateable(m, users),
    CFG.publishTimeoutMs
  );

  return [...existing, ...projected].map(({ id, authorId, lat, lng }) => ({ id, authorId, lat, lng }));
}

// ---------------------------------------------------------------------------
// 4. Volumen PostGIS por SQL directo (opcional)
// ---------------------------------------------------------------------------

function docker(argsList, input) {
  const res = spawnSync('docker', argsList, {
    input,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error((res.stderr || res.stdout || '').trim().slice(0, 500));
  return res.stdout.trim();
}

function findMessagesDbContainer() {
  if (CFG.dbContainer) return CFG.dbContainer;
  const byLabels = (filters) =>
    docker(['ps', ...filters.flatMap((f) => ['--filter', f]), '--format', '{{.Names}}'])
      .split(/\r?\n/)
      .filter(Boolean)[0];
  return (
    byLabels([`label=com.docker.compose.project=${CFG.project}`, 'label=com.docker.compose.service=messages-db']) ||
    byLabels(['label=com.docker.compose.service=messages-db']) ||
    ''
  );
}

function psql(container, sql) {
  return docker(
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'messages', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'],
    sql
  );
}

const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

function cleanBulkMessages() {
  const container = findMessagesDbContainer();
  if (!container) throw new Error('No se encontró el contenedor messages-db (define MESSAGES_DB_CONTAINER).');
  const deleted = psql(
    container,
    `WITH d AS (DELETE FROM messages WHERE moderation_reason = ${sqlStr(BULK_MARKER)} RETURNING 1)
     SELECT count(*) FROM d;`
  );
  log(`Eliminados ${deleted} mensajes de volumen PostGIS en ${container}.`);
}

function seedBulkMessages(users) {
  if (CFG.bulk === 0) {
    log('4/4 Volumen PostGIS: omitido (--skip-bulk / SEED_BULK_MESSAGES=0).');
    return { requested: 0, existing: 0, inserted: 0, skipped: true };
  }

  let container;
  try {
    container = findMessagesDbContainer();
  } catch (err) {
    warn(`Docker no disponible (${err.message}). Se omite el volumen PostGIS; los flujos funcionan igual.`);
    return { requested: CFG.bulk, existing: 0, inserted: 0, skipped: true, reason: 'docker_unavailable' };
  }
  if (!container) {
    warn('No se encontró el contenedor messages-db. Define MESSAGES_DB_CONTAINER. Se omite el volumen PostGIS.');
    return { requested: CFG.bulk, existing: 0, inserted: 0, skipped: true, reason: 'container_not_found' };
  }

  const existing = Number(
    psql(container, `SELECT count(*) FROM messages WHERE moderation_reason = ${sqlStr(BULK_MARKER)};`) || 0
  );
  const needed = Math.max(0, CFG.bulk - existing);
  log(`4/4 Volumen PostGIS en ${container}: existentes=${existing}, objetivo=${CFG.bulk}, a insertar=${needed}...`);

  if (needed > 0) {
    const BATCH = 1000;
    const now = Date.now();
    const parts = ['BEGIN;'];
    for (let start = 0; start < needed; start += BATCH) {
      const rows = [];
      for (let i = start; i < Math.min(needed, start + BATCH); i += 1) {
        const p = randomPoint();
        const author = users[Math.floor(rand() * users.length)];
        // Antigüedad sesgada hacia lo reciente (últimos 30 días)
        const ageMs = Math.floor(rand() ** 2 * 30 * 24 * 3600 * 1000);
        const ts = new Date(now - ageMs).toISOString();
        rows.push(`(${sqlStr(author.id)},${sqlStr(randomContent(p.zone))},${p.lng},${p.lat},${sqlStr(ts)})`);
      }
      parts.push(
        `INSERT INTO messages (sender_id, content, location, status, moderation_status, moderation_reason, created_at, updated_at)
         SELECT v.s::uuid, v.c, ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)::geography,
                'PUBLISHED', 'ALLOW', ${sqlStr(BULK_MARKER)}, v.ts::timestamptz, v.ts::timestamptz
         FROM (VALUES ${rows.join(',')}) AS v(s, c, lng, lat, ts);`
      );
    }
    parts.push('COMMIT;', 'ANALYZE messages;');
    psql(container, parts.join('\n'));
  }

  const total = Number(psql(container, "SELECT count(*) FROM messages WHERE status = 'PUBLISHED';") || 0);
  log(`  mensajes PUBLISHED totales en PostGIS: ${total}`);
  return { requested: CFG.bulk, existing, inserted: needed, totalPublished: total, container };
}

// ---------------------------------------------------------------------------
// Densidad observada (útil para interpretar las latencias de /nearby)
// ---------------------------------------------------------------------------

async function measureDensity() {
  const radii = [250, 500, 1000];
  const rows = [];
  for (const h of HOTSPOTS) {
    const row = { zone: h.id, lat: h.lat, lng: h.lng };
    for (const r of radii) {
      const res = await api('GET', `/api/messages/nearby?lat=${h.lat}&lng=${h.lng}&radius=${r}`, {
        timeoutMs: 60000,
      });
      row[`r${r}`] = Array.isArray(res.data) ? res.data.length : null;
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  if (CFG.cleanBulk) {
    cleanBulkMessages();
    return;
  }
  await resolveBaseUrl();
  log(`Destino: ${CFG.baseUrl}`);
  log(
    `Plan: ${CFG.users} usuarios, grado social ≈${CFG.friends} (+${CFG.pending} pendientes), ` +
      `${CFG.messages} mensajes vía API, ${CFG.bulk} mensajes de volumen PostGIS`
  );

  const users = await seedUsers();
  const social = await seedSocialGraph(users);
  const messages = await seedApiMessages(users);
  log(`  mensajes calificables listos: ${messages.length}`);
  const bulk = seedBulkMessages(users);

  log('Midiendo densidad de mensajes por zona (resultados de /nearby)...');
  const density = await measureDensity();
  console.table(density);

  const manifest = {
    generator: 'performance/seed-data.mjs',
    baseUrl: CFG.baseUrl,
    createdAt: new Date().toISOString(),
    randomSeed: CFG.randomSeed,
    // Contrato compartido con profiles/common.js (Persona 8): users[] y messages[]
    users,
    messages,
    hotspots: HOTSPOTS.map(({ id, lat, lng, sigmaM, weight }) => ({ id, lat, lng, sigmaM, weight })),
    stats: {
      users: users.length,
      social,
      rateableMessages: messages.length,
      bulk,
      density,
      tokensExpireAt: Math.min(...users.map((u) => u.tokenExpiresAt || Infinity)),
      elapsedSeconds: Math.round((Date.now() - t0) / 1000),
    },
  };

  fs.mkdirSync(path.dirname(CFG.manifest), { recursive: true });
  fs.writeFileSync(CFG.manifest, JSON.stringify(manifest, null, 2), 'utf-8');
  log(`Manifest escrito en ${CFG.manifest} (${manifest.stats.elapsedSeconds}s).`);
  log('Los tokens expiran en ~15 min; los escenarios de k6 los renuevan solos si hace falta.');
}

main().catch((err) => {
  console.error(`[seed] ERROR: ${err.message}`);
  process.exit(1);
});
