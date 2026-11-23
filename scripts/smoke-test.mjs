#!/usr/bin/env node
// Prueba de integracion de punta a punta contra el sistema levantado con
// `docker compose up`: recorre reverse proxy (HTTPS) -> frontends y gateway ->
// auth / messages / profile (REST) y network (GraphQL) con dos usuarios nuevos,
// igual que lo haria la aplicacion. Todo entra por el mismo origen publico
// (ver nginx/sites/https.conf):
//   https://localhost/api/...          API Gateway (WebSocket en /api/ws)
//   https://localhost/account, /login  panel SSR (Next.js, assets en /_next)
//   https://localhost/                 SPA Expo
//
// Uso:
//   node scripts/smoke-test.mjs [--url https://localhost] [--insecure]
//   node scripts/smoke-test.mjs --gateway <url> --frontend <url> --profile-web <url>
//
// Para verificar el certificado de la CA local (scripts/generate-certs.sh):
//   NODE_EXTRA_CA_CERTS=nginx/certs/ca.pem node scripts/smoke-test.mjs
// Con el autofirmado temporal del proxy, o solo para pruebas, usa --insecure
// (desactiva la verificacion del certificado).
//
// Termina con codigo 1 si alguna verificacion falla.

import { crc32, deflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

if (args.includes('--insecure') || args.includes('-k')) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const strip = (url) => url.replace(/\/$/, '');
const PUBLIC_URL = strip(option('--url', process.env.PUBLIC_URL || 'https://localhost'));
const GATEWAY = strip(option('--gateway', PUBLIC_URL));
const FRONTEND = strip(option('--frontend', PUBLIC_URL));
// Origen del panel SSR: sirve /account y /login detras del mismo proxy.
const PROFILE_WEB = strip(option('--profile-web', PUBLIC_URL));
const ORIGIN = new URL(FRONTEND).origin;

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

// PNG de un solo color, para subir un avatar sin depender de archivos externos.
function solidPng(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, Buffer.from([42, 199, 105]))]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function describeError(error) {
  if (!error) return '';
  const cause = error.cause?.code || error.cause?.message || '';
  return `${error.message}${cause ? ` (${cause})` : ''}`;
}

async function fetchText(url, init = {}) {
  try {
    const response = await fetch(url, { redirect: 'manual', ...init });
    return { status: response.status, headers: response.headers, text: await response.text() };
  } catch (error) {
    return { status: 0, headers: new Headers(), text: '', error };
  }
}

// La SPA y el panel deben cargarse por HTTPS desde el reverse proxy y no hacer
// referencia a URLs http:// (Mixed Content) ni a los puertos directos 8080-8082.
async function checkPerimeter() {
  for (const [name, url] of [
    ['gateway', GATEWAY],
    ['frontend', FRONTEND],
    ['panel SSR', PROFILE_WEB],
  ]) {
    check(`${name} se publica por https://`, url.startsWith('https://'), url);
  }

  const front = await fetchText(FRONTEND);
  check(
    'frontend (SPA) responde por el proxy',
    front.status === 200,
    `status ${front.status} ${describeError(front.error)}`
  );

  const scripts = [...front.text.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
    (m) => new URL(m[1], `${FRONTEND}/`).href
  );
  check(
    'frontend carga sus scripts desde el mismo origen HTTPS',
    scripts.length > 0 && scripts.every((src) => src.startsWith(`${ORIGIN}/`)),
    scripts.join(', ')
  );
  let bundle = '';
  for (const src of scripts) bundle += (await fetchText(src)).text;
  const directPorts = bundle.match(/https?:\/\/[a-z0-9.-]+:808[0-2]/gi) ?? [];
  check(
    'bundle del frontend sin URLs a los puertos directos 8080-8082',
    bundle.length > 0 && directPorts.length === 0,
    [...new Set(directPorts)].join(', ')
  );

  const login = await fetchText(`${PROFILE_WEB}/login`);
  check(
    'panel SSR responde en /login por el proxy',
    login.status === 200 && login.text.includes('GEOPICTO // CUENTA'),
    `status ${login.status} ${describeError(login.error)}`
  );
  // El proxy enruta /_next/* al panel; si llegaran a la SPA, el panel cargaria
  // sin estilos ni JavaScript.
  const assets = [...login.text.matchAll(/(?:src|href)="(\/_next\/[^"]+)"/g)].map((m) => m[1]);
  check('panel SSR referencia sus assets en /_next', assets.length > 0);
  if (assets[0]) {
    const asset = await fetchText(new URL(assets[0], `${PROFILE_WEB}/`).href);
    check('asset /_next del panel llega por el proxy', asset.status === 200, `status ${asset.status} ${assets[0]}`);
  }
  check('HTML del panel SSR sin URLs http://', !/(?:src|href|action)="http:\/\//i.test(login.text));

  // Sin sesion, /account redirige a /login. Como el panel transmite la
  // respuesta en streaming, la redireccion puede llegar como meta refresh.
  const account = await fetchText(`${PROFILE_WEB}/account`);
  const location = account.headers.get('location') ?? '';
  const redirectsToLogin =
    ([303, 307, 308].includes(account.status) && location.endsWith('/login')) ||
    (account.status === 200 && account.text.includes('url=/login'));
  check('panel sin sesion redirige a /login', redirectsToLogin, `status ${account.status} ${location}`);
  check('redireccion del panel no baja a http://', !location.startsWith('http://'), location);
}

const decodeHtml = (value) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

// Inicia sesion en el panel como lo hace un navegador sin JavaScript: envia el
// formulario del Server Action a traves del proxy y revisa que las cookies de
// sesion lleguen con HttpOnly (no legibles desde JavaScript) y Secure (el
// navegador nunca las envia por http://).
async function checkProfileWebLogin(username) {
  const page = await fetchText(`${PROFILE_WEB}/login`);
  const form = page.text.match(/<form[^>]*>([\s\S]*?)<\/form>/)?.[1] ?? '';
  const body = new FormData();
  for (const input of form.matchAll(/<input([^>]*)>/g)) {
    const name = input[1].match(/name="([^"]*)"/)?.[1];
    if (name?.startsWith('$ACTION')) body.append(name, decodeHtml(input[1].match(/value="([^"]*)"/)?.[1] ?? ''));
  }
  if ([...body.keys()].length === 0) {
    check('panel SSR: formulario de login con Server Action', false, 'no se encontro el formulario');
    return;
  }
  body.append('identifier', username);
  body.append('password', 'secreto123');

  // Next rechaza Server Actions cuyo Origin no coincide con el host que
  // reenvia el proxy (proteccion CSRF): esto tambien valida esas cabeceras.
  const response = await fetchText(`${PROFILE_WEB}/login`, {
    method: 'POST',
    headers: { Origin: ORIGIN },
    body,
  });
  const cookies = response.headers.getSetCookie();
  const session = cookies.filter((cookie) => cookie.startsWith('gp_profile_'));
  check(
    'panel SSR: login por el proxy entrega cookies de sesion',
    session.length === 2,
    `status ${response.status} ${cookies.map((c) => c.split(';')[0].split('=')[0]).join(', ')}`
  );
  for (const cookie of session) {
    const name = cookie.split('=')[0];
    check(
      `panel SSR: cookie ${name} HttpOnly; Secure`,
      /;\s*httponly/i.test(cookie) && /;\s*secure/i.test(cookie),
      cookie.replace(/=[^;]+/, '=<token>')
    );
  }
  check(
    'panel SSR: login redirige a /account',
    response.status === 303 && (response.headers.get('location') ?? '').endsWith('/account'),
    `status ${response.status} ${response.headers.get('location')}`
  );
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
  console.log(`Gateway: ${GATEWAY}  Frontend: ${FRONTEND}  Panel: ${PROFILE_WEB}\n`);

  // --- Infraestructura ---
  // El actuator del gateway no se publica en el perimetro: se usa una ruta
  // publica de la API para comprobar que el proxy llega al gateway.
  const health = await call('GET', '/api/messages/nearby?lat=0&lng=0&radius=1').catch((error) => ({ status: 0, error }));
  check('gateway responde por el proxy', health.status === 200, `status ${health.status} ${describeError(health.error)}`);

  // --- Perimetro: frontends detras del reverse proxy por HTTPS ---
  await checkPerimeter();

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

  // Los mensajes nacen PENDING y solo aparecen al publicarse, cuando el
  // servicio de moderacion responde. Si no responde, messages los publica en
  // modo degradado tras MODERATION_TIMEOUT_SECONDS (5 s) mas un barrido.
  const isListed = (res) =>
    res.status === 200 && Array.isArray(res.data) && res.data.some((m) => m.id === created.data?.id);
  let nearby;
  for (let attempt = 0; attempt < 25 && !(nearby && isListed(nearby)); attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
    nearby = await call('GET', `/api/messages/nearby?lat=${here.latitude}&lng=${here.longitude}&radius=500`);
  }
  check('buscar mensajes cercanos (tras publicarse)', isListed(nearby), `status ${nearby.status}`);

  const notMine = await call('DELETE', `/api/messages/${created.data?.id}`, { token: bob.token });
  check('otro usuario no puede borrar el mensaje', notMine.status !== 200);

  const deleted = await call('DELETE', `/api/messages/${created.data?.id}`, { token: aliceToken });
  check('el autor borra su mensaje', deleted.status === 200);

  // --- Red social por GraphQL (MongoDB) ---
  const graphql = (query, variables, token) =>
    call('POST', '/api/network/graphql', { token, body: { query, variables } });

  const request = await graphql(
    'mutation($id: UUID!) { sendFriendRequest(recipientId: $id) { id status sentByMe } }',
    { id: bob.user.id },
    aliceToken
  );
  const requestId = request.data?.data?.sendFriendRequest?.id;
  check(
    'GraphQL: enviar solicitud de amistad',
    request.status === 200 && !!requestId && request.data.data.sendFriendRequest.sentByMe === true,
    JSON.stringify(request.data)
  );

  const duplicateRequest = await graphql(
    'mutation($id: UUID!) { sendFriendRequest(recipientId: $id) { id } }',
    { id: alice.user.id },
    bob.token
  );
  check(
    'GraphQL: solicitud duplicada -> error CONFLICT',
    duplicateRequest.data?.errors?.[0]?.extensions?.code === 'CONFLICT',
    JSON.stringify(duplicateRequest.data)
  );

  const pending = await graphql('{ incomingRequests { id otherUserId } }', {}, bob.token);
  check(
    'GraphQL: solicitud recibida por el destinatario',
    pending.data?.data?.incomingRequests?.some(
      (f) => f.id === requestId && f.otherUserId === alice.user.id
    ),
    JSON.stringify(pending.data)
  );

  const accepted = await graphql(
    'mutation($id: ID!) { acceptFriendRequest(id: $id) { status } }',
    { id: requestId },
    bob.token
  );
  check(
    'GraphQL: aceptar solicitud',
    accepted.data?.data?.acceptFriendRequest?.status === 'ACCEPTED',
    JSON.stringify(accepted.data)
  );

  const dashboard = await graphql(
    '{ me friends { otherUserId status } incomingRequests { id } outgoingRequests { id } }',
    {},
    bob.token
  );
  check(
    'GraphQL: varias consultas en una sola peticion',
    dashboard.status === 200 &&
      dashboard.data?.data?.me === bob.user.id &&
      dashboard.data?.data?.friends?.[0]?.otherUserId === alice.user.id,
    JSON.stringify(dashboard.data)
  );

  const removed = await graphql(
    'mutation($id: UUID!) { removeFriend(friendId: $id) }',
    { id: alice.user.id },
    bob.token
  );
  check('GraphQL: eliminar amistad', removed.data?.data?.removeFriend === true);

  const notFriends = await graphql(
    'mutation($id: UUID!) { removeFriend(friendId: $id) }',
    { id: alice.user.id },
    bob.token
  );
  check(
    'GraphQL: error con codigo NOT_FOUND',
    notFriends.data?.errors?.[0]?.extensions?.code === 'NOT_FOUND',
    JSON.stringify(notFriends.data)
  );

  const gqlUnauth = await graphql('{ friends { id } }', {});
  check('GraphQL sin token -> 401', gqlUnauth.status === 401);

  // --- Perfiles ---
  // Se consulta el perfil de bob con el token de alice (y no /me, que lo crea de
  // forma perezosa) para comprobar que llego por el evento user.registered.v1.
  let bobProfile;
  for (let attempt = 0; attempt < 10 && bobProfile?.status !== 200; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
    bobProfile = await call('GET', `/api/profiles/${bob.user.id}`, { token: aliceToken });
  }
  check(
    'perfil creado por el evento de registro',
    bobProfile.status === 200 && bobProfile.data?.username === bob.user.username && /^#[0-9A-F]{6}$/.test(bobProfile.data?.color),
    JSON.stringify(bobProfile.data)
  );

  const edited = await call('PATCH', '/api/profiles/me', {
    token: aliceToken,
    body: { displayName: 'Alice Geo', about: 'Prueba de humo', color: '#1EA4E8' },
  });
  check(
    'editar perfil propio',
    edited.status === 200 && edited.data?.displayName === 'Alice Geo' && edited.data?.color === '#1EA4E8',
    JSON.stringify(edited.data)
  );

  const form = new FormData();
  form.append('file', new Blob([solidPng(96, 64)], { type: 'image/png' }), 'avatar.png');
  const uploaded = await fetch(`${GATEWAY}/api/profiles/me/avatar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${aliceToken}`, Origin: ORIGIN },
    body: form,
  });
  const avatarUrl = (await uploaded.json().catch(() => null))?.avatarUrl;
  check('subir avatar', uploaded.status === 200 && !!avatarUrl, `status ${uploaded.status}`);

  check(
    'avatarUrl por HTTPS en el origen publico (sin Mixed Content)',
    !!avatarUrl && avatarUrl.startsWith(`${GATEWAY}/api/profiles/avatars/`),
    avatarUrl
  );

  if (avatarUrl) {
    // Publica: sin token, como la pide una etiqueta <img>
    const avatar = await fetch(avatarUrl);
    check(
      'avatar publico en WebP',
      avatar.status === 200 && avatar.headers.get('content-type') === 'image/webp',
      `status ${avatar.status} ${avatar.headers.get('content-type')}`
    );
  }

  const batch = await call('GET', `/api/profiles/batch?ids=${alice.user.id},${bob.user.id}`, { token: bob.token });
  check(
    'resolver perfiles en lote',
    batch.status === 200 && batch.data?.length === 2 && batch.data[0]?.avatarUrl === avatarUrl,
    JSON.stringify(batch.data)
  );

  const profileUnauth = await call('GET', '/api/profiles/me');
  check('perfil sin token -> 401', profileUnauth.status === 401);

  // --- CORS (lo que hace el navegador antes de cada peticion) ---
  for (const [path, method] of [
    ['/api/auth/login', 'POST'],
    ['/api/auth/profile', 'PATCH'],
    ['/api/messages', 'POST'],
    ['/api/network/graphql', 'POST'],
    ['/api/profiles/me', 'PATCH'],
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

  // --- Panel SSR: login por Server Action y cookies de sesion ---
  await checkProfileWebLogin(bob.user.username);

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
