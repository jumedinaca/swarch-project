#!/usr/bin/env node
// =============================================================================
// demo-wiretap-tls.mjs — Demostración visual de tráfico plano vs. cifrado (S1)
// =============================================================================
// Abre un interceptor TCP pasivo (wiretap) en 127.0.0.1 sin sudo ni descifrado:
// simplemente copia los bytes crudos entre `curl` y el servidor real mientras
// se ejecuta un POST /api/auth/login real, e imprime exactamente lo que vería
// un atacante haciendo sniffing en la red.
//
//   - En P2 (HTTP :8080):  la ruta, usuario, contraseña y JWT aparecen en claro.
//   - En P3 (HTTPS :443):  el login funciona (HTTP 200, certificado validado
//                          contra nginx/certs/ca.pem), pero el interceptor solo
//                          ve registros TLS binarios ilegibles (0 datos en claro).
//
// Uso:
//   node scripts/demo-wiretap-tls.mjs                 # autodetecta P2 (HTTP) o P3 (HTTPS)
//   node scripts/demo-wiretap-tls.mjs --mode http     # fuerza HTTP plano contra :8080
//   node scripts/demo-wiretap-tls.mjs --mode https    # fuerza HTTPS cifrado contra :443
// =============================================================================

import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CA_CERT = join(ROOT, 'nginx', 'certs', 'ca.pem');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

let MODE = option('--mode', 'auto');
const TARGET_HOST = option('--host', '127.0.0.1');
const HTTP_PORT = Number(option('--http-port', '8080'));
const HTTPS_PORT = Number(option('--https-port', '443'));
const DEMO_PASSWORD = option('--password', 'MiClaveSecreta123!');

const isTTY = process.stdout.isTTY;
const C = isTTY
  ? {
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      cyan: '\x1b[36m',
      magenta: '\x1b[35m',
      bold: '\x1b[1m',
      dim: '\x1b[2m',
      reset: '\x1b[0m',
    }
  : { red: '', green: '', yellow: '', cyan: '', magenta: '', bold: '', dim: '', reset: '' };

function probePort(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(1500, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}

function startWiretap(targetHost, targetPort) {
  const captured = { c2s: [], s2c: [] };
  const server = net.createServer((clientSock) => {
    const upstream = net.connect({ host: targetHost, port: targetPort });

    clientSock.on('data', (chunk) => {
      captured.c2s.push(Buffer.from(chunk));
      upstream.write(chunk);
    });
    upstream.on('data', (chunk) => {
      captured.s2c.push(Buffer.from(chunk));
      clientSock.write(chunk);
    });

    clientSock.on('end', () => upstream.end());
    upstream.on('end', () => clientSock.end());
    clientSock.on('error', () => upstream.destroy());
    upstream.on('error', () => clientSock.destroy());
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        captured,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(r);
          }),
      });
    });
  });
}

async function runCurl(curlArgs) {
  const { stdout } = await execFileAsync('curl', curlArgs, { encoding: 'utf8' });
  const marker = '\n__META__';
  const idx = stdout.lastIndexOf(marker);
  if (idx < 0) return { body: stdout, status: 0, sslVerify: -1 };
  const body = stdout.slice(0, idx);
  const [statusStr, sslVerifyStr] = stdout.slice(idx + marker.length).trim().split(' ');
  return { body, status: Number(statusStr), sslVerify: Number(sslVerifyStr) };
}

function formatPrintableAscii(buf, maxBytes = 650) {
  const slice = buf.subarray(0, maxBytes);
  let out = '';
  for (const b of slice) {
    if (b === 10) out += '\n';
    else if (b === 13) continue;
    else if (b >= 32 && b <= 126) out += String.fromCharCode(b);
    else out += '.';
  }
  if (buf.length > maxBytes) out += `\n... (+${buf.length - maxBytes} bytes mas)`;
  return out;
}

function formatHexPreview(buf, maxBytes = 128) {
  const slice = buf.subarray(0, maxBytes);
  const lines = [];
  for (let i = 0; i < slice.length; i += 16) {
    const row = slice.subarray(i, i + 16);
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(row, (b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`  ${i.toString(16).padStart(4, '0')}  ${hex.padEnd(47, ' ')}  |${ascii}|`);
  }
  if (buf.length > maxBytes) lines.push(`  ... (+${buf.length - maxBytes} bytes cifrados mas)`);
  return lines.join('\n');
}

function parseTlsRecords(buf) {
  const names = { 20: 'ChangeCipherSpec (0x14)', 21: 'Alert (0x15)', 22: 'Handshake (0x16)', 23: 'Application Data cifrado (0x17)' };
  const found = [];
  let i = 0;
  while (i + 5 <= buf.length) {
    const type = buf[i];
    const verMajor = buf[i + 1];
    const verMinor = buf[i + 2];
    const len = buf.readUInt16BE(i + 3);
    if (!names[type] || verMajor !== 3 || len === 0 || i + 5 + len > buf.length) break;
    found.push(`${names[type]} (${len} B)`);
    i += 5 + len;
  }
  return found;
}

function highlightPlaintext(text, secrets) {
  let out = text;
  for (const s of secrets) {
    if (!s) continue;
    out = out.split(s).join(`${C.red}${C.bold}${s}${C.reset}`);
  }
  return out;
}

async function main() {
  if (!['auto', 'http', 'https'].includes(MODE)) {
    console.error(`Modo invalido: ${MODE}. Usa --mode auto|http|https.`);
    process.exit(2);
  }

  if (MODE === 'auto') {
    const httpsUp = await probePort(TARGET_HOST, HTTPS_PORT);
    const httpUp = await probePort(TARGET_HOST, HTTP_PORT);
    if (httpsUp) MODE = 'https';
    else if (httpUp) MODE = 'http';
    else {
      console.error(`${C.red}Error:${C.reset} No se detecto servidor en :${HTTPS_PORT} (P3) ni en :${HTTP_PORT} (P2).`);
      process.exit(1);
    }
  }

  const isHttps = MODE === 'https';
  const targetPort = isHttps ? HTTPS_PORT : HTTP_PORT;
  const username = `wiretap_${Date.now().toString(36).slice(-5)}`;
  const email = `${username}@geopicto.org`;

  console.log(`${C.bold}${C.cyan}=============================================================================${C.reset}`);
  console.log(`${C.bold}${C.cyan} Escenario 1 — Captura Pasiva de Trafico (Wiretap TCP: ${isHttps ? `HTTPS :${targetPort}` : `HTTP :${targetPort}`})${C.reset}`);
  console.log(`${C.bold}${C.cyan}=============================================================================${C.reset}`);

  // 1. Registro previo silencioso (fuera del wiretap) para que el login devuelva 200 + JWT real.
  const caArgs = isHttps
    ? (existsSync(CA_CERT) ? ['--cacert', CA_CERT] : ['-k'])
    : [];
  const directBase = isHttps ? `https://localhost:${HTTPS_PORT}` : `http://${TARGET_HOST}:${HTTP_PORT}`;
  const regPayload = JSON.stringify({ username, email, password: DEMO_PASSWORD });
  try {
    await runCurl([
      '-sS', '--max-time', '8', ...caArgs,
      '-X', 'POST', '-H', 'Content-Type: application/json',
      '-d', regPayload,
      '-w', '\n__META__%{http_code} %{ssl_verify_result}',
      `${directBase}/api/auth/register`,
    ]);
  } catch {
    // Si falla el registro (p. ej. rate limit), igualmente capturamos el POST /api/auth/login.
  }

  // 2. Arrancar wiretap TCP pasivo y ejecutar curl POST /api/auth/login a traves de el.
  const tap = await startWiretap(TARGET_HOST, targetPort);
  const loginPayload = JSON.stringify({ usernameOrEmail: username, password: DEMO_PASSWORD });
  let res;
  try {
    const loginArgs = [
      '-sS', '--max-time', '10',
      '-X', 'POST', '-H', 'Content-Type: application/json',
      '-d', loginPayload,
      '-w', '\n__META__%{http_code} %{ssl_verify_result}',
    ];
    if (isHttps) {
      loginArgs.push(...caArgs, '--resolve', `localhost:${tap.port}:127.0.0.1`, `https://localhost:${tap.port}/api/auth/login`);
    } else {
      loginArgs.push(`http://127.0.0.1:${tap.port}/api/auth/login`);
    }
    res = await runCurl(loginArgs);
  } finally {
    await tap.close();
  }

  let parsed = null;
  try { parsed = JSON.parse(res.body); } catch { /* ignore */ }
  const jwt = parsed?.data?.token || '';
  const jwtPrefix = jwt ? jwt.slice(0, 28) : 'eyJhbGci';

  const c2sBuf = Buffer.concat(tap.captured.c2s);
  const s2cBuf = Buffer.concat(tap.captured.s2c);
  const allWireBuf = Buffer.concat([c2sBuf, s2cBuf]);

  console.log(`  Destino real      : ${isHttps ? `https://localhost:${targetPort}` : `http://${TARGET_HOST}:${targetPort}`}/api/auth/login`);
  console.log(`  Respuesta a curl  : HTTP ${res.status}${isHttps ? ` (CA local verificada: ${res.sslVerify === 0 ? 'SI' : 'NO'})` : ''}${jwt ? ` · JWT recibido (${jwt.length} chars)` : ''}`);
  console.log(`  Bytes capturados  : ${c2sBuf.length} B cliente->servidor · ${s2cBuf.length} B servidor->cliente\n`);

  // 3. Mostrar exactamente lo que capturo el atacante en el cable.
  if (!isHttps) {
    const secrets = ['/api/auth/login', username, DEMO_PASSWORD, jwt || jwtPrefix];
    console.log(`${C.bold}--- Bytes crudos en el cable: CLIENTE -> SERVIDOR (HTTP texto plano) ---${C.reset}`);
    console.log(highlightPlaintext(formatPrintableAscii(c2sBuf), secrets));
    console.log(`\n${C.bold}--- Bytes crudos en el cable: SERVIDOR -> CLIENTE (HTTP texto plano) ---${C.reset}`);
    console.log(highlightPlaintext(formatPrintableAscii(s2cBuf), secrets));
  } else {
    const c2sRecords = parseTlsRecords(c2sBuf);
    const s2cRecords = parseTlsRecords(s2cBuf);
    console.log(`${C.bold}--- Registros TLS capturados: CLIENTE -> SERVIDOR ---${C.reset}`);
    console.log(`  ${c2sRecords.length ? c2sRecords.join(' -> ') : '(flujo binario TLS)'}`);
    console.log(formatHexPreview(c2sBuf, 112));
    console.log(`\n${C.bold}--- Registros TLS capturados: SERVIDOR -> CLIENTE ---${C.reset}`);
    console.log(`  ${s2cRecords.length ? s2cRecords.join(' -> ') : '(flujo binario TLS)'}`);
    console.log(formatHexPreview(s2cBuf, 112));
  }

  // 4. Busqueda forense de secretos en los bytes crudos capturados.
  const checks = [
    ['Ruta /api/auth/login', '/api/auth/login'],
    ['Usuario', username],
    ['Contrasena', DEMO_PASSWORD],
    ['JWT (token)', jwt || jwtPrefix],
  ];

  console.log(`\n${C.bold}--- Busqueda de secretos en los bytes crudos del cable ---${C.reset}`);
  let exposedCount = 0;
  for (const [label, needle] of checks) {
    const found = allWireBuf.includes(Buffer.from(needle, 'utf8'));
    if (found) exposedCount += 1;
    const tag = found
      ? `${C.red}[VISIBLE EN CLARO]${C.reset}`
      : `${C.green}[NO VISIBLE / CIFRADO]${C.reset}`;
    console.log(`  ${tag}  ${label}`);
  }

  console.log('');
  if (exposedCount > 0) {
    console.log(`${C.red}${C.bold}VEREDICTO [EXPUESTO]:${C.reset} Un atacante en la red capturo ${exposedCount}/4 datos sensibles en texto plano.`);
  } else {
    console.log(`${C.green}${C.bold}VEREDICTO [MITIGADO]:${C.reset} 0/4 datos sensibles visibles en el cable; el login funciono (HTTP ${res.status}) bajo TLS.`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
