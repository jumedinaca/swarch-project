/**
 * GeoPicto — Implementación de los 4 flujos arquitectónicos (Persona 7)
 *
 *   Flujo 1  nearbyRead       GET  /api/messages/nearby          PostGIS (ST_DWithin + GIST)
 *   Flujo 2  writeEvents      POST /api/messages                 escritura + RabbitMQ + moderación
 *                             PUT  /api/ratings/messages/:id     escritura + evento a reputación
 *   Flujo 3  authLogin        POST /api/auth/login               verificación Argon2id (CPU)
 *   Flujo 4  networkGraphql   POST /api/network/graphql          GraphQL + MongoDB
 *
 * Cada función ejecuta UNA interacción de usuario. Los parámetros se ajustan
 * por variables de entorno (ver performance/README.md).
 */

import http from 'k6/http';
import { sleep } from 'k6';

import {
  BASE_URL,
  MESSAGES,
  USERS,
  authHeaders,
  authOkDuration,
  authRejectedDuration,
  currentUser,
  flowAuthDuration,
  flowAuthReqs,
  flowGraphqlDuration,
  flowGraphqlReqs,
  flowNearbyDuration,
  flowNearbyReqs,
  flowWriteDuration,
  flowWriteReqs,
  graphqlErrorRate,
  homeHotspot,
  messageContent,
  messagePublishLatency,
  messagePublishTimeouts,
  nearbyPayloadBytes,
  nearbyResults,
  params,
  pointNear,
  queryPoint,
  recordOutcome,
  weightedChoice,
  withAuth,
  writePostDuration,
  writeRatingDuration,
} from './workload.js';

const num = (v, def) => {
  const n = Number.parseFloat(v ?? '');
  return Number.isFinite(n) ? n : def;
};

// ---------------------------------------------------------------------------
// Flujo 1 — Lectura geoespacial (PostGIS)
// ---------------------------------------------------------------------------

// Radios en metros con su peso: la mayoría mira su cuadra/barrio, pocos la ciudad
const NEARBY_RADII = __ENV.NEARBY_RADII || '100:15,250:30,500:30,1000:18,2000:7';
// Fracción de respuestas cuyo cuerpo se inspecciona (contar resultados cuesta CPU al generador)
const NEARBY_BODY_SAMPLE = num(__ENV.NEARBY_BODY_SAMPLE, 0.1);

export function nearbyRead() {
  const p = queryPoint();
  const radius = weightedChoice(NEARBY_RADII);
  const inspect = Math.random() < NEARBY_BODY_SAMPLE;

  const res = http.get(
    `${BASE_URL}/api/messages/nearby?lat=${p.lat}&lng=${p.lng}&radius=${radius}`,
    params('nearby_read', 'GET /api/messages/nearby', {
      responseType: inspect ? 'text' : 'none',
      tags: { flow: 'nearby_read', name: 'GET /api/messages/nearby', radius, zone: p.zone },
    })
  );

  const ok = recordOutcome(res, flowNearbyDuration, flowNearbyReqs, [200], 'nearby');

  if (ok && inspect && typeof res.body === 'string') {
    nearbyPayloadBytes.add(res.body.length, { radius });
    // Conteo barato sin parsear el JSON completo: un objeto por mensaje
    const count = res.body === '[]' || res.body === 'null' ? 0 : res.body.split('"sender_id"').length - 1;
    nearbyResults.add(count, { radius });
  }
}

// ---------------------------------------------------------------------------
// Flujo 2 — Escritura + eventos asíncronos (RabbitMQ)
// ---------------------------------------------------------------------------

const WRITE_POST_RATIO = num(__ENV.WRITE_POST_RATIO, 0.5);
// Fracción de mensajes creados cuya publicación (moderación vía RabbitMQ) se mide de punta a punta
const ASYNC_PROBE_RATE = num(__ENV.ASYNC_PROBE_RATE, 0);
const ASYNC_PROBE_TIMEOUT_S = num(__ENV.ASYNC_PROBE_TIMEOUT_S, 15);
const ASYNC_PROBE_INTERVAL_S = num(__ENV.ASYNC_PROBE_INTERVAL_S, 0.25);

function pickRateableMessage(userId) {
  const len = MESSAGES.length;
  if (len === 0) return null;
  const start = Math.floor(Math.random() * len);
  for (let offset = 0; offset < Math.min(len, 20); offset += 1) {
    const m = MESSAGES[(start + offset) % len];
    if (m.authorId !== userId) return m;
  }
  return null;
}

/**
 * Sondea GET /api/messages/:id hasta que la moderación decide (deja de estar
 * PENDING). Mide la latencia del pipeline asíncrono messages -> RabbitMQ ->
 * moderation -> messages, que no se ve en el tiempo de respuesta del POST.
 */
function probePublication(user, data, messageId) {
  const started = Date.now();
  const deadline = started + ASYNC_PROBE_TIMEOUT_S * 1000;
  while (Date.now() < deadline) {
    sleep(ASYNC_PROBE_INTERVAL_S);
    const res = withAuth(user, data, (token) =>
      http.get(
        `${BASE_URL}/api/messages/${messageId}`,
        params('async_probe', 'probe: GET /api/messages/:id', { headers: authHeaders(token) })
      )
    );
    if (res.status === 200) {
      let status = null;
      try {
        status = res.json('status');
      } catch (_) {
        status = null;
      }
      if (status && status !== 'PENDING') {
        messagePublishLatency.add(Date.now() - started, { result: String(status) });
        return;
      }
    }
  }
  messagePublishTimeouts.add(1);
}

export function postMessage(data) {
  const user = currentUser();
  const p = pointNear(homeHotspot(), 1.2);
  const probe = Math.random() < ASYNC_PROBE_RATE;

  const res = withAuth(user, data, (token) =>
    http.post(
      `${BASE_URL}/api/messages`,
      JSON.stringify({ content: messageContent(p.zone), latitude: p.lat, longitude: p.lng }),
      params('write_events', 'POST /api/messages', {
        headers: authHeaders(token),
        expected: [201],
        responseType: probe ? 'text' : 'none',
      })
    )
  );
  writePostDuration.add(res.timings.duration);
  const ok = recordOutcome(res, flowWriteDuration, flowWriteReqs, [201], 'write:post');

  if (ok && probe) {
    let id = null;
    try {
      id = res.json('id');
    } catch (_) {
      id = null;
    }
    if (id) probePublication(user, data, id);
  }
}

export function putRating(data) {
  const user = currentUser();
  const message = pickRateableMessage(user.id);
  if (!message) {
    // Sin mensajes calificables en el manifest: degradar a publicar
    postMessage(data);
    return;
  }
  const value = Math.random() < 0.7 ? 'LIKE' : 'DISLIKE';

  const res = withAuth(user, data, (token) =>
    http.put(
      `${BASE_URL}/api/ratings/messages/${message.id}`,
      JSON.stringify({ value }),
      params('write_events', 'PUT /api/ratings/messages/:id', {
        headers: authHeaders(token),
        responseType: 'none',
      })
    )
  );
  writeRatingDuration.add(res.timings.duration);
  recordOutcome(res, flowWriteDuration, flowWriteReqs, [200], 'write:rating');
}

export function writeEvents(data) {
  if (Math.random() < WRITE_POST_RATIO) postMessage(data);
  else putRating(data);
}

// ---------------------------------------------------------------------------
// Flujo 3 — Autenticación (Argon2id)
// ---------------------------------------------------------------------------

// Fracción de intentos con contraseña incorrecta (también ejecutan Argon2 verify)
const AUTH_FAIL_RATIO = num(__ENV.AUTH_FAIL_RATIO, 0.1);
// Cerrar la sesión creada tras cada login exitoso (evita acumular sesiones en auth-db)
const AUTH_LOGOUT = (__ENV.AUTH_LOGOUT || 'false').toLowerCase() === 'true';

export function authLogin() {
  // A diferencia de los otros flujos, rota por todos los usuarios sembrados
  const user = USERS[(__VU * 31 + __ITER) % USERS.length];
  const wrongPassword = Math.random() < AUTH_FAIL_RATIO;
  const expected = wrongPassword ? 401 : 200;

  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({
      usernameOrEmail: Math.random() < 0.5 ? user.email : user.username,
      password: wrongPassword ? `${user.password}-wrong` : user.password,
    }),
    params('auth_login', 'POST /api/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      expected: [expected],
      responseType: AUTH_LOGOUT && !wrongPassword ? 'text' : 'none',
      tags: { flow: 'auth_login', name: 'POST /api/auth/login', outcome: wrongPassword ? 'rejected' : 'ok' },
    })
  );

  (wrongPassword ? authRejectedDuration : authOkDuration).add(res.timings.duration);
  const ok = recordOutcome(res, flowAuthDuration, flowAuthReqs, [expected], wrongPassword ? 'auth:rejected' : 'auth:ok');

  if (ok && AUTH_LOGOUT && !wrongPassword) {
    let token = null;
    try {
      token = res.json('data.token');
    } catch (_) {
      token = null;
    }
    if (token) {
      http.post(
        `${BASE_URL}/api/auth/logout`,
        null,
        params('auth_logout', 'POST /api/auth/logout', { headers: authHeaders(token), responseType: 'none' })
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Flujo 4 — Grafo social (GraphQL + MongoDB)
// ---------------------------------------------------------------------------

const GRAPHQL_OPERATIONS = {
  // Lo que pide la app al abrir la pestaña de red (mismo query que Persona 8)
  dashboard: JSON.stringify({
    query: '{ me friends { otherUserId status } incomingRequests { id } outgoingRequests { id } }',
  }),
  // Lista de amigos paginada con más campos
  friendsPage: JSON.stringify({
    query:
      'query($limit: Int!) { friends(limit: $limit) { id otherUserId status sentByMe createdAt updatedAt } }',
    variables: { limit: 50 },
  }),
  // Bandeja de solicitudes pendientes en ambos sentidos
  requests: JSON.stringify({
    query:
      '{ incomingRequests(limit: 20) { id otherUserId requestedBy createdAt } ' +
      'outgoingRequests(limit: 20) { id otherUserId requestedBy createdAt } }',
  }),
};
const GRAPHQL_MIX = __ENV.GRAPHQL_MIX || 'dashboard:50,friendsPage:30,requests:20';

export function networkGraphql(data) {
  const user = currentUser();
  const op = weightedChoice(GRAPHQL_MIX);
  const body = GRAPHQL_OPERATIONS[op] || GRAPHQL_OPERATIONS.dashboard;

  const res = withAuth(user, data, (token) =>
    http.post(
      `${BASE_URL}/api/network/graphql`,
      body,
      params('network_graphql', 'POST /api/network/graphql', {
        headers: authHeaders(token),
        responseType: 'text',
        tags: { flow: 'network_graphql', name: 'POST /api/network/graphql', operation: op },
      })
    )
  );

  const ok = recordOutcome(res, flowGraphqlDuration, flowGraphqlReqs, [200], 'graphql');
  if (ok) {
    // GraphQL responde 200 incluso con errores de resolución
    graphqlErrorRate.add(typeof res.body === 'string' && res.body.indexOf('"errors"') !== -1, { operation: op });
  }
}
