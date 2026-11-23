#!/usr/bin/env node
// Escenario de seguridad 4 — Rate Limiting / Throttling Pattern.
//
// Lanza tres ataques de rafaga contra el sistema levantado con
// `docker compose up` y verifica el comportamiento esperado segun el modo:
//
//   1. Abuso de escritura: un usuario publica mensajes en rafaga (POST /api/messages).
//   2. Fuerza bruta: rafaga de logins con contraseña incorrecta desde una IP.
//   3. Agotamiento de recursos: rafaga de consultas geoespaciales (GET /api/messages/nearby).
//
// Modos (--mode):
//
//   protected  (por defecto) Gateway con RATE_LIMIT_ENABLED=true. Se espera que el
//              exceso reciba 429 Too Many Requests con Retry-After y
//              X-RateLimit-Remaining, sin degradar el servicio para otros usuarios.
//
//   vulnerable Gateway con RATE_LIMIT_ENABLED=false (sistema sin la contramedida).
//              Se espera que TODAS las peticiones del atacante lleguen a los
//              microservicios: ninguna recibe 429. El script lo reporta como
//              "vulnerabilidad demostrada" y estima cuanto tardaria un ataque de
//              diccionario con y sin el limite.
//
// Uso:
//   node scripts/test-rate-limit.mjs [--mode protected|vulnerable]
//        [--gateway https://localhost] [--insecure] [--attempts 30] [--nearby-attempts 150]
//        [--json performance/results/rate-limit-protected.json]
//
//   Para cambiar de modo:
//     RATE_LIMIT_ENABLED=false docker compose up -d gateway   # vulnerable
//     RATE_LIMIT_ENABLED=true  docker compose up -d gateway   # protected
//   Para verificar el certificado de la CA local (scripts/generate-certs.sh):
//     NODE_EXTRA_CA_CERTS=nginx/certs/ca.pem node scripts/test-rate-limit.mjs
//   Con certificado autofirmado temporal, usa --insecure (o -k).
//
// Ojo: en modo protected la cuota de login/registro es por IP (10/min por
// defecto); si se acaba de correr el smoke test o el propio script, conviene
// esperar un minuto.
//
// Termina con codigo 1 si alguna verificacion del modo elegido falla.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

if (args.includes('--insecure') || args.includes('-k')) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const MODE = option('--mode', 'protected');
const GATEWAY = option('--gateway', process.env.PUBLIC_URL || 'https://localhost').replace(/\/$/, '');
const ATTEMPTS = Number(option('--attempts', '30'));
const NEARBY_ATTEMPTS = Number(option('--nearby-attempts', '150'));
const JSON_OUT = option('--json', null);

if (!['protected', 'vulnerable'].includes(MODE)) {
  console.error(`--mode invalido: ${MODE} (usa protected o vulnerable)`);
  process.exit(2);
}
const PROTECTED = MODE === 'protected';

// Debe coincidir con rate-limit.policies.auth en gateway/src/main/resources/application.yml
// (solo se usa para la estimacion del ataque de diccionario).
const AUTH_POLICY_PER_MINUTE = Number(option('--auth-per-minute', '10'));
const DICTIONARY_SIZE = 10_000;

let failures = 0;
const report = { mode: MODE, gateway: GATEWAY, startedAt: new Date().toISOString(), attacks: {}, checks: [] };

function check(name, condition, detail = '') {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name}${!condition && detail ? ` -> ${detail}` : ''}`);
  report.checks.push({ name, ok: !!condition, detail: condition ? undefined : detail || undefined });
  if (!condition) failures += 1;
}

async function call(method, path, { token, body } = {}) {
  const started = performance.now();
  const response = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, headers: response.headers, ms: performance.now() - started };
}

async function burst(count, makeRequest) {
  const started = performance.now();
  const results = await Promise.all(Array.from({ length: count }, (_, i) => makeRequest(i)));
  return { results, wallMs: performance.now() - started };
}

async function register(prefix) {
  const name = `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const res = await call('POST', '/api/auth/register', {
    body: { username: name, email: `${name}@geopicto.org`, password: 'secreto123' },
  });
  check(`registro de ${prefix}`, res.status === 201 && !!res.data?.data?.token, `status ${res.status}`);
  return res.data?.data;
}

const percentile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(1));
};

function summarize(key, label, { results, wallMs }) {
  const byStatus = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const blocked = results.filter((r) => r.status === 429);
  const passed = results.filter((r) => r.status !== 429);
  const firstBlocked = results.findIndex((r) => r.status === 429);
  const summary = {
    label,
    requests: results.length,
    byStatus,
    reachedBackend: passed.length,
    blocked: blocked.length,
    firstBlockedRequest: firstBlocked >= 0 ? firstBlocked + 1 : null,
    wallMs: Number(wallMs.toFixed(1)),
    throughputRps: Number(((results.length / wallMs) * 1000).toFixed(1)),
    latencyMs: {
      allP50: percentile(results.map((r) => r.ms), 0.5),
      allP95: percentile(results.map((r) => r.ms), 0.95),
      reachedBackendP50: percentile(passed.map((r) => r.ms), 0.5),
      reachedBackendP95: percentile(passed.map((r) => r.ms), 0.95),
      blockedP50: percentile(blocked.map((r) => r.ms), 0.5),
      blockedP95: percentile(blocked.map((r) => r.ms), 0.95),
    },
  };
  report.attacks[key] = summary;

  console.log(`\n  ${label}`);
  console.log(`  respuestas por codigo: ${JSON.stringify(byStatus)}`);
  console.log(`  llegaron al microservicio: ${summary.reachedBackend}/${summary.requests}   bloqueadas en el gateway (429): ${summary.blocked}`);
  if (summary.firstBlockedRequest) console.log(`  primera peticion bloqueada: #${summary.firstBlockedRequest}`);
  console.log(`  rafaga completa en ${summary.wallMs} ms (${summary.throughputRps} req/s)`);
  if (passed.length) {
    console.log(`  latencia de las que llegaron al servicio: p50 ${summary.latencyMs.reachedBackendP50} ms, p95 ${summary.latencyMs.reachedBackendP95} ms`);
  }
  if (blocked.length) {
    console.log(`  latencia de los 429: p50 ${summary.latencyMs.blockedP50} ms, p95 ${summary.latencyMs.blockedP95} ms (no llegan al microservicio)`);
  }
  console.log();
  return summary;
}

// Si el gateway aplica rate limit, toda respuesta de una ruta limitada trae X-RateLimit-Limit.
function limiterActive(results) {
  return results.some((r) => r.headers.get('x-ratelimit-limit') !== null);
}

function warnIfModeMismatch(results) {
  const active = limiterActive(results);
  if (PROTECTED && !active) {
    console.log('  AVISO: las respuestas no traen X-RateLimit-Limit; el gateway parece tener RATE_LIMIT_ENABLED=false.');
    console.log('         Usa --mode vulnerable o levanta el gateway con RATE_LIMIT_ENABLED=true.\n');
  }
  if (!PROTECTED && active) {
    console.log('  AVISO: las respuestas traen X-RateLimit-Limit; el gateway tiene el rate limit ACTIVO.');
    console.log('         Levanta el gateway con RATE_LIMIT_ENABLED=false para demostrar la vulnerabilidad.\n');
  }
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

async function main() {
  console.log(`Modo: ${MODE.toUpperCase()}   Gateway: ${GATEWAY}`);
  console.log(`Intentos por rafaga: ${ATTEMPTS} (escritura y login), ${NEARBY_ATTEMPTS} (nearby)\n`);

  // --- Preparacion: dos usuarios legitimos ---
  const attacker = await register('spammer');
  const victim = await register('legit');
  if (!attacker || !victim) {
    throw new Error('No se pudieron registrar los usuarios (¿cuota de auth agotada? espera 1 min)');
  }

  // --- Ataque 1: rafaga de publicaciones de un usuario ---
  const here = { latitude: 4.6371, longitude: -74.0834 };
  const posts = await burst(ATTEMPTS, (i) =>
    call('POST', '/api/messages', { token: attacker.token, body: { content: `spam ${i}`, ...here } })
  );
  warnIfModeMismatch(posts.results);
  const spam = summarize('writeBurst', 'Ataque 1: rafaga de POST /api/messages (por usuario)', posts);
  const stored = posts.results.filter((r) => r.status === 201).length;

  if (PROTECTED) {
    check('la rafaga de publicaciones recibe 429', spam.blocked > 0);
    const blockedPost = posts.results.find((r) => r.status === 429);
    check('el 429 trae Retry-After', !!blockedPost?.headers.get('retry-after'));
    check('el 429 trae X-RateLimit-Remaining = 0', blockedPost?.headers.get('x-ratelimit-remaining') === '0');
    check('el 429 trae mensaje JSON', typeof blockedPost?.data?.message === 'string');
  } else {
    check('VULNERABLE: ninguna publicacion es frenada (0 respuestas 429)', spam.blocked === 0, `${spam.blocked} bloqueadas`);
    check(`VULNERABLE: el atacante guarda los ${ATTEMPTS} mensajes de spam`, stored === ATTEMPTS, `${stored} guardados`);
  }

  const legitPost = await call('POST', '/api/messages', {
    token: victim.token,
    body: { content: 'Sigo pudiendo publicar', ...here },
  });
  check('otro usuario sigue publicando (201)', legitPost.status === 201, `status ${legitPost.status}`);

  // --- Ataque 2: fuerza bruta sobre login ---
  const logins = await burst(ATTEMPTS, (i) =>
    call('POST', '/api/auth/login', {
      body: { usernameOrEmail: victim.user.username, password: `adivina${i}` },
    })
  );
  const brute = summarize('loginBruteForce', 'Ataque 2: fuerza bruta en POST /api/auth/login (por IP)', logins);
  check('ningun intento adivino la contraseña', logins.results.every((r) => r.status !== 200));

  // Estimacion de un ataque de diccionario con el ritmo medido en esta rafaga.
  const guessesPerSecond = brute.throughputRps;
  const withoutLimit = DICTIONARY_SIZE / guessesPerSecond;
  const withLimit = (DICTIONARY_SIZE / AUTH_POLICY_PER_MINUTE) * 60;
  report.dictionaryEstimate = {
    dictionarySize: DICTIONARY_SIZE,
    measuredGuessesPerSecond: guessesPerSecond,
    secondsWithoutLimit: Number(withoutLimit.toFixed(1)),
    secondsWithLimit: withLimit,
    authPolicyPerMinute: AUTH_POLICY_PER_MINUTE,
  };
  console.log(`  Diccionario de ${DICTIONARY_SIZE.toLocaleString('es')} contraseñas desde una IP:`);
  console.log(`    sin rate limit (ritmo medido ${guessesPerSecond} intentos/s): ~${formatDuration(withoutLimit)}`);
  console.log(`    con rate limit (${AUTH_POLICY_PER_MINUTE} intentos/min por IP):          ~${formatDuration(withLimit)}\n`);

  // auth tiene su propio bloqueo por cuenta (5 fallos -> 423 Locked por 15 min), pero
  // lee el estado antes de verificar la contraseña: en una rafaga concurrente
  // muchas peticiones lo leen "desbloqueado" a la vez y todas se verifican.
  const verified = logins.results.filter((r) => r.status === 401).length;
  const locked = logins.results.filter((r) => r.status === 423).length;
  report.attacks.loginBruteForce.passwordsVerified = verified;
  report.attacks.loginBruteForce.accountLocked = locked;
  console.log(`  contraseñas verificadas por auth con Argon2 (401): ${verified}   cuenta bloqueada (423): ${locked}`);
  console.log(`  (el bloqueo por cuenta de auth permite 5 fallos; ${verified > 5 ? `en la rafaga concurrente se verificaron ${verified}` : 'no fue superado'})\n`);

  if (PROTECTED) {
    check('la fuerza bruta recibe 429', brute.blocked > 0);
    const retryAfter = Number(logins.results.find((r) => r.status === 429)?.headers.get('retry-after'));
    check('Retry-After indica cuando reintentar', retryAfter >= 1, `Retry-After ${retryAfter}`);
  } else {
    check('VULNERABLE: ningun intento de login es frenado (0 respuestas 429)', brute.blocked === 0, `${brute.blocked} bloqueados`);
    check(
      `VULNERABLE: los ${ATTEMPTS} intentos llegan al servicio auth (401 o 423)`,
      verified + locked === ATTEMPTS,
      `${verified + locked} llegaron a auth`
    );
  }

  // --- El sistema sigue disponible tras los ataques de escritura y login ---
  const nearby = await call('GET', '/api/messages/nearby?lat=4.6371&lng=-74.0834&radius=500');
  check('las lecturas siguen respondiendo tras los ataques (nearby 200)', nearby.status === 200, `status ${nearby.status}`);

  // --- Ataque 3: rafaga de consultas geoespaciales (PostGIS) ---
  const reads = await burst(NEARBY_ATTEMPTS, (i) =>
    call('GET', `/api/messages/nearby?lat=${(4.6371 + i * 1e-4).toFixed(6)}&lng=-74.0834&radius=5000`)
  );
  const flood = summarize('nearbyFlood', 'Ataque 3: rafaga de GET /api/messages/nearby (por IP)', reads);
  if (PROTECTED) {
    check('la rafaga de consultas geoespaciales recibe 429', flood.blocked > 0);
  } else {
    check('VULNERABLE: todas las consultas geoespaciales llegan a PostGIS (0 respuestas 429)', flood.blocked === 0, `${flood.blocked} bloqueadas`);
  }

  // Las cuotas son independientes: agotar la de lectura por IP no bloquea la escritura de otro usuario.
  const afterFlood = await call('POST', '/api/messages', {
    token: victim.token,
    body: { content: 'Publico aunque la IP agoto la cuota de lectura', ...here },
  });
  check('otro usuario sigue publicando tras la rafaga de lecturas (201)', afterFlood.status === 201, `status ${afterFlood.status}`);

  // --- Resultado ---
  report.finishedAt = new Date().toISOString();
  report.failures = failures;
  if (JSON_OUT) {
    await mkdir(dirname(JSON_OUT), { recursive: true });
    await writeFile(JSON_OUT, JSON.stringify(report, null, 2));
    console.log(`\nResultados guardados en ${JSON_OUT}`);
  }

  if (failures === 0) {
    console.log(
      PROTECTED
        ? '\nEscenario 4 verificado: la contramedida corta los ataques con 429 y el servicio sigue disponible'
        : '\nVulnerabilidad demostrada: sin Rate Limiting todas las peticiones del atacante llegan a los microservicios'
    );
  } else {
    console.log(`\n${failures} verificacion(es) fallida(s)`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
