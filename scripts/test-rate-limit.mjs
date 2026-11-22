#!/usr/bin/env node
// Escenario de seguridad 4 — Rate Limiting / Throttling Pattern.
//
// Simula dos ataques contra el sistema levantado con `docker compose up` y
// verifica que el gateway los corta con 429 Too Many Requests sin degradar el
// servicio para los demas usuarios:
//
//   1. Abuso de escritura: un usuario publica mensajes en rafaga
//      -> tras su cuota recibe 429, pero otro usuario sigue publicando (201).
//   2. Fuerza bruta: rafaga de logins con contraseña incorrecta desde una IP
//      -> tras la cuota estricta recibe 429 con Retry-After, y el sistema
//      sigue respondiendo las lecturas (nearby -> 200).
//
// Uso:
//   node scripts/test-rate-limit.mjs [--gateway http://localhost:8080] [--attempts 30]
//   (detras del Reverse Proxy: --gateway https://localhost, con NODE_TLS_REJECT_UNAUTHORIZED=0
//    si el certificado es autofirmado)
//
// Ojo: la cuota de login/registro es por IP (10/min por defecto); si se acaba
// de correr el smoke test conviene esperar un minuto.
//
// Termina con codigo 1 si alguna verificacion falla.

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const GATEWAY = option('--gateway', 'http://localhost:8080');
const ATTEMPTS = Number(option('--attempts', '30'));

let failures = 0;

function check(name, condition, detail = '') {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name}${!condition && detail ? ` -> ${detail}` : ''}`);
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

async function register(prefix) {
  const name = `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const res = await call('POST', '/api/auth/register', {
    body: { username: name, email: `${name}@geopicto.org`, password: 'secreto123' },
  });
  check(`registro de ${prefix}`, res.status === 201 && !!res.data?.data?.token, `status ${res.status}`);
  return res.data?.data;
}

function summarize(label, results) {
  const byStatus = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const firstBlocked = results.findIndex((r) => r.status === 429);
  const blocked = results.filter((r) => r.status === 429).map((r) => r.ms).sort((a, b) => a - b);
  const p = (q) => blocked[Math.min(blocked.length - 1, Math.floor(q * blocked.length))]?.toFixed(1);

  console.log(`\n  ${label}`);
  console.log(`  respuestas por codigo: ${JSON.stringify(byStatus)}`);
  console.log(`  primera peticion bloqueada: #${firstBlocked + 1}`);
  if (blocked.length) console.log(`  latencia de los 429: p50 ${p(0.5)} ms, p95 ${p(0.95)} ms (no llegan al microservicio)`);
  return { firstBlocked, blocked: blocked.length };
}

async function main() {
  console.log(`Gateway: ${GATEWAY}  Intentos por rafaga: ${ATTEMPTS}\n`);

  // --- Preparacion: dos usuarios legitimos ---
  const attacker = await register('spammer');
  const victim = await register('legit');
  if (!attacker || !victim) throw new Error('No se pudieron registrar los usuarios (¿cuota de auth agotada? espera 1 min)');

  // --- Ataque 1: rafaga de publicaciones de un usuario ---
  const here = { latitude: 4.6371, longitude: -74.0834 };
  const posts = await Promise.all(
    Array.from({ length: ATTEMPTS }, (_, i) =>
      call('POST', '/api/messages', { token: attacker.token, body: { content: `spam ${i}`, ...here } })
    )
  );
  const spam = summarize('Ataque 1: rafaga de POST /api/messages (por usuario)', posts);
  console.log();
  check('la rafaga de publicaciones recibe 429', spam.blocked > 0);
  const blockedPost = posts.find((r) => r.status === 429);
  check('el 429 trae Retry-After', !!blockedPost?.headers.get('retry-after'));
  check('el 429 trae X-RateLimit-Remaining = 0', blockedPost?.headers.get('x-ratelimit-remaining') === '0');
  check('el 429 trae mensaje JSON', typeof blockedPost?.data?.message === 'string');

  const legitPost = await call('POST', '/api/messages', {
    token: victim.token,
    body: { content: 'Sigo pudiendo publicar', ...here },
  });
  check('otro usuario sigue publicando (201)', legitPost.status === 201, `status ${legitPost.status}`);

  // --- Ataque 2: fuerza bruta sobre login ---
  const logins = await Promise.all(
    Array.from({ length: ATTEMPTS }, (_, i) =>
      call('POST', '/api/auth/login', {
        body: { usernameOrEmail: victim.user.username, password: `adivina${i}` },
      })
    )
  );
  const brute = summarize('Ataque 2: fuerza bruta en POST /api/auth/login (por IP)', logins);
  console.log();
  check('la fuerza bruta recibe 429', brute.blocked > 0);
  check('ningun intento adivino la contraseña', logins.every((r) => r.status !== 200));
  const retryAfter = Number(logins.find((r) => r.status === 429)?.headers.get('retry-after'));
  check('Retry-After indica cuando reintentar', retryAfter >= 1, `Retry-After ${retryAfter}`);

  // --- El sistema sigue disponible ---
  const nearby = await call('GET', '/api/messages/nearby?lat=4.6371&lng=-74.0834&radius=500');
  check('las lecturas siguen respondiendo tras los ataques (nearby 200)', nearby.status === 200, `status ${nearby.status}`);

  console.log(`\n${failures === 0 ? 'Escenario 4 verificado' : `${failures} verificacion(es) fallida(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
