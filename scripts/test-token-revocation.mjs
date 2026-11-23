#!/usr/bin/env node
// Escenario de seguridad 5 — Token Revocation Blacklist Pattern.
//
// Demuestra dos cosas con el sistema levantado:
//   1. Un access token válido sirve en una ruta protegida antes del logout.
//   2. Después de POST /api/auth/logout, el mismo token:
//        - con la blacklist activa  -> 401 (el gateway lo rechaza de inmediato)
//        - con la blacklist apagada -> 200 (vulnerabilidad de token replay)
//
// El patrón se controla con TOKEN_BLACKLIST_ENABLED, que debe valer lo mismo en
// auth (escribe en Redis) y en gateway (consulta Redis).
//
// Uso:
//   node scripts/test-token-revocation.mjs [--gateway http://localhost:8080] [--mode auto|on|off]
//
//   --mode on   exige que el token revocado reciba 401 (falla si se acepta).
//   --mode off  exige que el token revocado se acepte (reproduce la vulnerabilidad).
//   --mode auto (por defecto) solo reporta el estado; no falla por el resultado.
//
// Otros:
//   --username <usuario>  inicia sesión con una cuenta existente en vez de registrar.
//   --password <clave>    contraseña para --username (por defecto secreto123).
//   --prefix <prefijo>    prefijo de las claves Redis (por defecto auth:revoked:).
//   --no-redis            no consulta Redis con `docker compose exec`.
//   --redis-service <s>   nombre del servicio Redis en Compose (por defecto redis).
//
// Alternar el patrón:
//   TOKEN_BLACKLIST_ENABLED=true  docker compose up -d --force-recreate auth gateway
//   TOKEN_BLACKLIST_ENABLED=false docker compose up -d --force-recreate auth gateway
//
// Termina con código 1 si falla una verificación previa o si el resultado no
// coincide con --mode.

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const hasFlag = (name) => args.includes(name);

const GATEWAY = option('--gateway', 'http://localhost:8080');
const MODE = option('--mode', 'auto');
const USERNAME = option('--username', '');
const PASSWORD = option('--password', 'secreto123');
const PREFIX = option('--prefix', process.env.TOKEN_BLACKLIST_PREFIX || 'auth:revoked:');
const REDIS_SERVICE = option('--redis-service', 'redis');
const SKIP_REDIS = hasFlag('--no-redis');

if (!['auto', 'on', 'off'].includes(MODE)) {
  console.error(`Modo inválido: ${MODE}. Usa --mode auto|on|off.`);
  process.exit(2);
}

let failures = 0;

function check(name, condition, detail = '') {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name}${!condition && detail ? ` -> ${detail}` : ''}`);
  if (!condition) failures += 1;
}

async function call(method, path, { token, body } = {}) {
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
  return { status: response.status, data, headers: response.headers };
}

function decodeJwt(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function registerOrLogin() {
  if (USERNAME) {
    const res = await call('POST', '/api/auth/login', {
      body: { usernameOrEmail: USERNAME, password: PASSWORD },
    });
    if (res.status === 429) {
      throw new Error('Login bloqueado por rate limiting. Espera 1 minuto o usa RATE_LIMIT_ENABLED=false.');
    }
    check(`login de ${USERNAME}`, res.status === 200 && !!res.data?.data?.token, JSON.stringify(res.data));
    return res.data?.data;
  }

  const name = `revoked${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const res = await call('POST', '/api/auth/register', {
    body: { username: name, email: `${name}@geopicto.org`, password: PASSWORD },
  });
  if (res.status === 429) {
    throw new Error('Registro bloqueado por rate limiting. Espera 1 minuto o usa RATE_LIMIT_ENABLED=false.');
  }
  check(`registro de ${name}`, res.status === 201 && !!res.data?.data?.token, JSON.stringify(res.data));
  return res.data?.data;
}

function redisCli(...cliArgs) {
  if (SKIP_REDIS) return null;
  try {
    return execFileSync(
      'docker',
      ['compose', 'exec', '-T', REDIS_SERVICE, 'redis-cli', '-n', '1', ...cliArgs],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
    ).trim();
  } catch {
    // Docker no disponible, el servicio Redis tiene otro nombre o se ejecuta
    // contra un gateway remoto: no es un fallo del escenario.
    return null;
  }
}

async function main() {
  console.log(`Gateway: ${GATEWAY}  Modo: ${MODE}\n`);

  const health = await call('GET', '/actuator/health');
  check('gateway saludable', health.data?.status === 'UP', JSON.stringify(health.data));

  const session = await registerOrLogin();
  if (!session?.token) throw new Error('No se obtuvo un access token.');

  const claims = decodeJwt(session.token);
  const remaining = claims?.exp ? Math.max(0, claims.exp - Math.floor(Date.now() / 1000)) : null;
  console.log(`\n  Token emitido:`);
  console.log(`    sub = ${claims?.sub}`);
  console.log(`    sid = ${claims?.sid}`);
  console.log(`    jti = ${claims?.jti}`);
  console.log(`    exp = ${claims?.exp ? new Date(claims.exp * 1000).toISOString() : '?'} (${remaining ?? '?'} s restantes)`);

  // Ruta que solo valida la firma del JWT (no consulta la sesión en auth).
  // Es la que evidencia si el gateway está aplicando la blacklist.
  const before = await call('GET', '/api/profiles/me', { token: session.token });
  check('el token sirve antes del logout (GET /api/profiles/me -> 200)', before.status === 200,
    `status ${before.status}`);

  const logout = await call('POST', '/api/auth/logout', { token: session.token });
  check('logout (POST /api/auth/logout -> 200)', logout.status === 200, `status ${logout.status}`);

  // Sin esperar: el token debe dejar de servir inmediatamente.
  const reusedProfiles = await call('GET', '/api/profiles/me', { token: session.token });
  const reusedAuth = await call('GET', '/api/auth/profile', { token: session.token });
  const mitigated = reusedProfiles.status === 401;

  console.log('\n  Reutilización del mismo access token después del logout:');
  console.log(
    `    GET /api/profiles/me  -> ${reusedProfiles.status}  ` +
      (mitigated
        ? '(bloqueado por el gateway: blacklist activa)'
        : '(ACEPTADO: token replay posible)')
  );
  console.log(
    `    GET /api/auth/profile -> ${reusedAuth.status}  ` +
      '(auth siempre valida la sesión en PostgreSQL; defensa en profundidad)'
  );
  check('auth rechaza el token revocado aunque la blacklist esté apagada', reusedAuth.status === 401,
    `status ${reusedAuth.status}`);

  // El logout solo revoca esa sesión: una sesión nueva debe seguir funcionando.
  const second = await call('POST', '/api/auth/login', {
    body: { usernameOrEmail: session.user?.username, password: PASSWORD },
  });
  if (second.status === 200 && second.data?.data?.token) {
    const secondProfile = await call('GET', '/api/profiles/me', { token: second.data.data.token });
    check('una sesión nueva sigue funcionando (200)', secondProfile.status === 200,
      `status ${secondProfile.status}`);
    await call('POST', '/api/auth/logout', { token: second.data.data.token });
  } else {
    console.log(`  (No se pudo abrir una segunda sesión para la comprobación: status ${second.status})`);
  }

  // Inspección directa de Redis: demuestra el TTL automático de la clave.
  const key = claims?.sid ? `${PREFIX}sid:${claims.sid}` : null;
  if (key && !SKIP_REDIS) {
    const value = redisCli('GET', key);
    const ttl = redisCli('TTL', key);
    if (value === null) {
      console.log(`\n  Redis: no se pudo consultar (¿docker compose disponible?). Clave esperada: ${key}`);
    } else if (value) {
      console.log(`\n  Redis: GET ${key} -> ${value}   TTL -> ${ttl} s`);
      const ttlNumber = Number(ttl);
      if (mitigated) {
        check('la clave de revocación existe en Redis con TTL positivo', ttlNumber > 0, `TTL ${ttl}`);
        check('el TTL no supera la vida restante del access token',
          remaining === null || ttlNumber <= remaining + 5, `TTL ${ttl}, restante ${remaining}`);
      }
    } else {
      console.log(`\n  Redis: la clave ${key} no existe (TTL ${ttl}).`);
    }
  }

  if (MODE === 'on') {
    check('la blacklist bloquea el token revocado (401)', mitigated, `status ${reusedProfiles.status}`);
  } else if (MODE === 'off') {
    check('sin blacklist el token revocado se acepta (vulnerabilidad reproducida)', !mitigated,
      `status ${reusedProfiles.status}`);
  } else {
    console.log(
      `\n  Modo auto: ${mitigated ? 'patrón activo (token bloqueado)' : 'patrón inactivo (token reutilizable)'}.`
    );
  }

  console.log(`
  Cómo alternar el patrón:
    # Mitigación activa
    TOKEN_BLACKLIST_ENABLED=true  docker compose up -d --force-recreate auth gateway
    node scripts/test-token-revocation.mjs --mode on

    # Vulnerabilidad (sin blacklist)
    TOKEN_BLACKLIST_ENABLED=false docker compose up -d --force-recreate auth gateway
    node scripts/test-token-revocation.mjs --mode off

  Inspeccionar Redis:
    docker compose exec redis redis-cli -n 1 --scan --pattern '${PREFIX}*'
    docker compose exec redis redis-cli -n 1 TTL ${key ?? `${PREFIX}sid:<sid>`}
`);

  console.log(`${failures === 0 ? 'Escenario 5 verificado' : `${failures} verificación(es) fallida(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
