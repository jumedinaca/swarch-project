#!/usr/bin/env node
// Genera un JWT de desarrollo firmado con JWT_SECRET, con el formato que exige
// el API Gateway (ver docs/jwt-contract.md). Sirve para probar las rutas
// protegidas mientras no exista el servicio de autenticacion.
//
// Uso:
//   node scripts/dev-token.mjs [user-uuid] [--hours N]
//
// Lee JWT_SECRET de la variable de entorno o, si no esta, del .env de la raiz.
// Imprime solo el token en stdout, para poder usarlo en $(...).

import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_SECRET_BYTES = 32;

function fail(message) {
  console.error(`dev-token: ${message}`);
  process.exit(1);
}

function readSecret() {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  let contents;
  try {
    contents = readFileSync(envPath, 'utf8');
  } catch {
    fail('JWT_SECRET no esta definido y no se encontro .env en la raiz del repositorio.');
  }

  const line = contents.split(/\r?\n/).find((l) => l.startsWith('JWT_SECRET='));
  const value = line?.slice('JWT_SECRET='.length).trim().replace(/^["']|["']$/g, '');
  if (!value) {
    fail('JWT_SECRET esta vacio en .env.');
  }
  return value;
}

function parseArgs(argv) {
  let userId;
  let hours = 24;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--hours') {
      hours = Number(argv[++i]);
      if (!Number.isFinite(hours) || hours <= 0) {
        fail('--hours debe ser un numero mayor que cero.');
      }
    } else if (!userId) {
      userId = argv[i];
    } else {
      fail(`argumento inesperado: ${argv[i]}`);
    }
  }

  if (!userId) {
    userId = randomUUID();
    console.error(`dev-token: sin user-uuid, se usa ${userId}`);
  } else if (!UUID_PATTERN.test(userId)) {
    fail(`"${userId}" no es un UUID; el gateway rechaza tokens cuyo sub no lo sea.`);
  }

  return { userId, hours };
}

const base64url = (value) => Buffer.from(value).toString('base64url');

const secret = readSecret();
if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) {
  fail(`JWT_SECRET debe tener al menos ${MIN_SECRET_BYTES} bytes.`);
}

const { userId, hours } = parseArgs(process.argv.slice(2));
const now = Math.floor(Date.now() / 1000);

const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const payload = base64url(JSON.stringify({ sub: userId, iat: now, exp: now + Math.round(hours * 3600) }));
const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');

console.log(`${header}.${payload}.${signature}`);
