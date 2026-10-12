#!/usr/bin/env node
// Prueba de integracion de punta a punta contra el sistema levantado con
// `docker compose up`: recorre frontend -> gateway -> auth / messages / network
// con dos usuarios nuevos, igual que lo haria la aplicacion.
//
// Uso:
//   node scripts/smoke-test.mjs [--gateway http://localhost:8080] [--frontend http://localhost:8081]
//
// Termina con codigo 1 si alguna verificacion falla.

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const GATEWAY = option('--gateway', 'http://localhost:8080');
const FRONTEND = option('--frontend', 'http://localhost:8081');
const ORIGIN = FRONTEND;

let failures = 0;

function check(name, condition, detail = '') {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name}${!condition && detail ? ` -> ${detail}` : ''}`);
  if (!condition) failures += 1;
}

async function call(method, path, { token, body, headers = {} } = {}) {
  const response = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Origin: ORIGIN,
      ...headers,
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

async function register(prefix) {
  const name = `${prefix}${Date.now().toString(36)}`;
  const res = await call('POST', '/api/auth/register', {
    body: { username: name, email: `${name}@geopicto.org`, password: 'secreto123' },
  });
  check(`registro de ${prefix}`, res.status === 201 && res.data?.success, JSON.stringify(res.data));
  return res.data?.data;
}

async function main() {
  console.log(`Gateway: ${GATEWAY}  Frontend: ${FRONTEND}\n`);

  // --- Infraestructura ---
  const health = await call('GET', '/actuator/health');
  check('gateway saludable', health.data?.status === 'UP');
  const front = await fetch(FRONTEND).then((r) => r.status).catch(() => 0);
  check('frontend responde', front === 200, `status ${front}`);

  // --- Autenticacion ---
  const alice = await register('alice');
  const bob = await register('bob');
  if (!alice || !bob) throw new Error('No se pudieron registrar los usuarios de prueba');

  const duplicate = await call('POST', '/api/auth/register', {
    body: { username: alice.user.username, email: 'otro@geopicto.org', password: 'secreto123' },
  });
  check('registro duplicado -> 409 con mensaje', duplicate.status === 409 && !!duplicate.data?.message);

  const badLogin = await call('POST', '/api/auth/login', {
    body: { usernameOrEmail: alice.user.username, password: 'incorrecta' },
  });
  check('login con contraseña incorrecta -> 401', badLogin.status === 401);

  const login = await call('POST', '/api/auth/login', {
    body: { usernameOrEmail: alice.user.email, password: 'secreto123' },
  });
  check('login con correo', login.status === 200 && !!login.data?.data?.token);

  const profile = await call('GET', '/api/auth/profile', { token: alice.token });
  check('perfil con token', profile.status === 200 && profile.data?.data?.id === alice.user.id);

  const refreshed = await call('POST', '/api/auth/refresh', {
    body: { refreshToken: alice.refreshToken },
  });
  check('renovacion con refresh token', refreshed.status === 200 && !!refreshed.data?.data?.token);
  const aliceToken = refreshed.data?.data?.token ?? alice.token;

  // --- Mensajes ---
  const here = { latitude: 4.6371, longitude: -74.0834 };
  const created = await call('POST', '/api/messages', {
    token: aliceToken,
    body: { content: 'Hola desde la prueba de integracion', ...here },
  });
  check(
    'crear mensaje (X-User-ID desde el JWT)',
    created.status === 201 && created.data?.sender_id === alice.user.id,
    JSON.stringify(created.data)
  );

  const unauth = await call('POST', '/api/messages', { body: { content: 'x', ...here } });
  check('crear mensaje sin token -> 401', unauth.status === 401);

  const forged = await call('POST', '/api/messages', {
    body: { content: 'x', ...here },
    headers: { 'X-User-ID': alice.user.id },
  });
  check('X-User-ID falsificado sin token -> 401', forged.status === 401);

  const nearby = await call(
    'GET',
    `/api/messages/nearby?lat=${here.latitude}&lng=${here.longitude}&radius=500`
  );
  check(
    'buscar mensajes cercanos',
    nearby.status === 200 && Array.isArray(nearby.data) && nearby.data.some((m) => m.id === created.data?.id)
  );

  const notMine = await call('DELETE', `/api/messages/${created.data?.id}`, { token: bob.token });
  check('otro usuario no puede borrar el mensaje', notMine.status !== 200);

  const deleted = await call('DELETE', `/api/messages/${created.data?.id}`, { token: aliceToken });
  check('el autor borra su mensaje', deleted.status === 200);

  // --- Red social (MongoDB) ---
  const request = await call('POST', '/api/network/request', {
    token: aliceToken,
    body: { recipient_id: bob.user.id },
  });
  check('enviar solicitud de amistad', request.status === 201, JSON.stringify(request.data));

  const incoming = await call('GET', '/api/network/request/incoming', { token: bob.token });
  check(
    'solicitud recibida por el destinatario',
    incoming.status === 200 && incoming.data?.friendships?.some((f) => f.id === request.data?.id)
  );

  const accepted = await call('POST', `/api/network/request/accept/${request.data?.id}`, {
    token: bob.token,
  });
  check('aceptar solicitud', accepted.status === 200 && accepted.data?.status === 'accepted');

  const friends = await call('GET', '/api/network/friends', { token: aliceToken });
  check('lista de amigos', friends.status === 200 && friends.data?.friendships?.length === 1);

  const networkUnauth = await call('GET', '/api/network/friends');
  check('red social sin token -> 401', networkUnauth.status === 401);

  // --- CORS (lo que hace el navegador antes de cada peticion) ---
  for (const [path, method] of [
    ['/api/auth/login', 'POST'],
    ['/api/auth/profile', 'PATCH'],
    ['/api/messages', 'POST'],
    ['/api/network/friends', 'GET'],
  ]) {
    const preflight = await call('OPTIONS', path, {
      headers: {
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    check(
      `CORS ${method} ${path}`,
      preflight.status === 200 && preflight.headers.get('access-control-allow-origin') === ORIGIN,
      `status ${preflight.status}`
    );
  }

  // --- Logout ---
  const logout = await call('POST', '/api/auth/logout', { token: aliceToken });
  check('logout', logout.status === 200);
  const afterLogout = await call('POST', '/api/auth/refresh', {
    body: { refreshToken: refreshed.data?.data?.refreshToken },
  });
  check('refresh tras logout -> 401', afterLogout.status === 401);

  console.log(failures === 0 ? '\nTodo el sistema funciona.' : `\n${failures} verificacion(es) fallaron.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`smoke-test: ${error.message}`);
  process.exit(1);
});
