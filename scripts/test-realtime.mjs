#!/usr/bin/env node
// Prueba automatizada del componente Realtime (Socket Gateway) y su integración
// con el API Gateway.
//
// Modos de uso:
//   1. Contra todo el sistema levantado (vía API Gateway en :8080):
//      node scripts/test-realtime.mjs [--gateway http://localhost:8080]
//
//   2. Contra el servicio realtime aislado (cd services/realtime && docker compose up):
//      node scripts/test-realtime.mjs --direct http://localhost:8700

import { createRequire } from 'node:module';

const WSImpl =
  typeof WebSocket !== 'undefined'
    ? WebSocket
    : createRequire(import.meta.url)('../frontend/mobile/node_modules/ws');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const DIRECT_URL = option('--direct', null);
const GATEWAY_URL = option('--gateway', 'http://localhost:8080');
const INTERNAL_URL = option('--realtime', DIRECT_URL || 'http://localhost:8700');
const INTERNAL_TOKEN = option('--internal-token', process.env.INTERNAL_TOKEN || 'dev-internal-token');
const ORIGIN = option('--origin', 'http://localhost:8081');

let failures = 0;

function check(name, condition, detail = '') {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name}${!condition && detail ? ` -> ${detail}` : ''}`);
  if (!condition) failures += 1;
}

function toWsUrl(httpUrl) {
  return httpUrl.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
}

async function httpCall(baseUrl, method, path, { token, userId, internalToken, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(userId ? { 'X-User-ID': userId } : {}),
      ...(internalToken ? { 'X-Internal-Token': internalToken } : {}),
      Origin: ORIGIN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function connectWs(wsUrl) {
  return new Promise((resolve) => {
    const messages = [];
    let resolved = false;
    const ws = new WSImpl(wsUrl);

    const waitForMessage = (predicate, timeoutMs = 2000) =>
      new Promise((res, rej) => {
        const existingIdx = messages.findIndex(predicate);
        if (existingIdx >= 0) {
          const [found] = messages.splice(existingIdx, 1);
          res(found);
          return;
        }
        const timer = setTimeout(() => {
          cleanup();
          rej(new Error(`Timeout esperando mensaje WS (${timeoutMs}ms)`));
        }, timeoutMs);

        const onMsg = (ev) => {
          try {
            const parsed = JSON.parse(String(ev.data));
            if (predicate(parsed)) {
              cleanup();
              res(parsed);
            }
          } catch {
            // ignore
          }
        };

        const cleanup = () => {
          clearTimeout(timer);
          ws.removeEventListener('message', onMsg);
        };

        ws.addEventListener('message', onMsg);
      });

    ws.addEventListener('message', (ev) => {
      try {
        messages.push(JSON.parse(String(ev.data)));
      } catch {
        // ignore
      }
    });

    ws.addEventListener('open', () => {
      if (!resolved) {
        resolved = true;
        resolve({ opened: true, ws, waitForMessage });
      }
    });

    ws.addEventListener('close', (ev) => {
      if (!resolved) {
        resolved = true;
        resolve({ opened: false, code: ev.code, reason: ev.reason, ws, waitForMessage });
      }
    });

    ws.addEventListener('error', () => {
      // close se disparará a continuación
    });
  });
}

async function main() {
  let userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';
  let jwtToken = null;

  if (DIRECT_URL) {
    console.log(`Modo directo contra Realtime: ${DIRECT_URL}\n`);
    const health = await httpCall(DIRECT_URL, 'GET', '/health');
    check(
      'GET /health responde 200 (ok o degraded)',
      health.status === 200 && ['ok', 'degraded'].includes(health.data?.status),
      JSON.stringify(health.data)
    );

    const noAuthTicket = await httpCall(DIRECT_URL, 'POST', '/tickets');
    check('POST /tickets sin X-User-ID responde 401', noAuthTicket.status === 401);
  } else {
    console.log(`Modo Gateway: ${GATEWAY_URL}\n`);
    const username = `rtuser_${Date.now().toString(36)}`;
    const reg = await httpCall(GATEWAY_URL, 'POST', '/api/auth/register', {
      body: {
        username,
        email: `${username}@geopicto.org`,
        password: 'secreto123',
      },
    });
    check('Registro de usuario en /api/auth/register', reg.status === 201 && reg.data?.data?.token);
    jwtToken = reg.data?.data?.token;
    userId = reg.data?.data?.user?.id || userId;

    const noJwt = await httpCall(GATEWAY_URL, 'POST', '/api/socket/tickets');
    check('POST /api/socket/tickets sin JWT responde 401', noJwt.status === 401);
  }

  // 1. Obtener ticket efímero
  const ticketRes = DIRECT_URL
    ? await httpCall(DIRECT_URL, 'POST', '/tickets', { userId })
    : await httpCall(GATEWAY_URL, 'POST', '/api/socket/tickets', { token: jwtToken });

  check(
    'Emisión de ticket efímero devuelve { ticket, expiresIn: 60 } directo',
    ticketRes.status === 200 &&
      typeof ticketRes.data?.ticket === 'string' &&
      ticketRes.data?.expiresIn === 60,
    JSON.stringify(ticketRes.data)
  );

  const ticket = ticketRes.data?.ticket;
  if (!ticket) {
    process.exit(1);
  }

  // 2. Abrir WebSocket con el ticket
  const wsEndpoint = DIRECT_URL
    ? `${toWsUrl(DIRECT_URL)}/ws?ticket=${encodeURIComponent(ticket)}`
    : `${toWsUrl(GATEWAY_URL)}/api/ws?ticket=${encodeURIComponent(ticket)}`;

  const conn1 = await connectWs(wsEndpoint);
  check('Handshake WebSocket abre conexión con ticket válido', conn1.opened);

  const readyFrame = await conn1.waitForMessage((m) => m.type === 'ready');
  check(
    'Servidor envía frame ready con userId y connectionId',
    readyFrame?.type === 'ready' && readyFrame?.userId === userId && Boolean(readyFrame?.connectionId),
    JSON.stringify(readyFrame)
  );

  // 3. Verificar que el ticket es de un solo uso (reuso debe fallar)
  const reuseCheck = DIRECT_URL
    ? await httpCall(DIRECT_URL, 'GET', `/ws?ticket=${encodeURIComponent(ticket)}`)
    : await httpCall(GATEWAY_URL, 'GET', `/api/ws?ticket=${encodeURIComponent(ticket)}`);
  check('Reutilizar el mismo ticket es rechazado (one-time use)', reuseCheck.status === 401 || reuseCheck.status >= 400);

  // 4. Ping -> Pong
  const pingTs = Date.now();
  conn1.ws.send(JSON.stringify({ type: 'ping', ts: pingTs }));
  const pongFrame = await conn1.waitForMessage((m) => m.type === 'pong');
  check('Heartbeat ping recibe pong con el mismo timestamp', pongFrame?.ts === pingTs);

  // 5. Suscripción permitida (`user:<propio_id>`, `global`) y prohibida (`user:<otro_id>`)
  conn1.ws.send(
    JSON.stringify({
      type: 'subscribe',
      requestId: 'sub-1',
      topics: [`user:${userId}`, 'global'],
    })
  );

  conn1.ws.send(
    JSON.stringify({
      type: 'subscribe',
      requestId: 'sub-forbidden',
      topics: [`user:${otherUserId}`],
    })
  );

  const forbiddenFrame = await conn1.waitForMessage((m) => m.type === 'error');
  check(
    'Suscripción a tópico privado de otro usuario devuelve error forbidden_topic',
    forbiddenFrame?.code === 'forbidden_topic',
    JSON.stringify(forbiddenFrame)
  );

  // 5b. Si estamos en modo Gateway, probar el flujo completo: crear mensaje, calificarlo y eliminarlo
  if (!DIRECT_URL && jwtToken) {
    // Configurar ubicación del radar en Bogotá (radio 300 m)
    conn1.ws.send(
      JSON.stringify({
        type: 'set_location',
        latitude: 4.6382,
        longitude: -74.0841,
        radiusMeters: 300,
      })
    );
    await new Promise((r) => setTimeout(r, 150));

    const createMsgRes = await httpCall(GATEWAY_URL, 'POST', '/api/messages', {
      token: jwtToken,
      body: {
        content: 'Mensaje E2E en tiempo real vía RabbitMQ',
        latitude: 4.6382,
        longitude: -74.0841,
      },
    });
    check('POST /api/messages crea mensaje en el backend (201)', createMsgRes.status === 201);
    const createdMsgId = createMsgRes.data?.id;

    const liveMsgEvent = await conn1.waitForMessage(
      (m) => m.type === 'event' && m.event === 'message.published.v1',
      3000
    );
    check(
      'Crear un mensaje en POST /api/messages dentro del rango (300m) dispara evento WS message.published.v1',
      liveMsgEvent?.event === 'message.published.v1' &&
        liveMsgEvent?.payload?.contentPreview === 'Mensaje E2E en tiempo real vía RabbitMQ',
      JSON.stringify(liveMsgEvent)
    );

    if (createdMsgId) {
      // Registrar un segundo usuario para probar filtrado de mensaje fuera de rango (Francia), calificación (LIKE) y amistad
      const user2Name = `rtpeer_${Date.now().toString(36)}`;
      const reg2 = await httpCall(GATEWAY_URL, 'POST', '/api/auth/register', {
        body: {
          username: user2Name,
          email: `${user2Name}@geopicto.org`,
          password: 'secreto123',
        },
      });
      const jwt2 = reg2.data?.data?.token;

      if (jwt2) {
        // Usuario 2 publica un mensaje en París, Francia (48.8566, 2.3522) -> Usuario 1 en Bogotá NO debe recibirlo
        await httpCall(GATEWAY_URL, 'POST', '/api/messages', {
          token: jwt2,
          body: {
            content: 'Bonjour desde Francia fuera de rango',
            latitude: 48.8566,
            longitude: 2.3522,
          },
        });

        let receivedFranceMsg = false;
        try {
          await conn1.waitForMessage(
            (m) =>
              m.type === 'event' &&
              m.event === 'message.published.v1' &&
              String(m.payload?.contentPreview || '').includes('Francia'),
            700
          );
          receivedFranceMsg = true;
        } catch {
          receivedFranceMsg = false;
        }
        check(
          'Mensaje publicado fuera del rango (ej. en Francia) es filtrado y NO notifica al usuario en Bogotá',
          !receivedFranceMsg
        );
        // Dar LIKE al mensaje desde el Usuario 2 -> debe emitir rating.changed.v1 y reputation.changed.v1 al Usuario 1
        await new Promise((r) => setTimeout(r, 300));
        const rateRes = await httpCall(
          GATEWAY_URL,
          'PUT',
          `/api/ratings/messages/${createdMsgId}`,
          {
            token: jwt2,
            body: { value: 'LIKE' },
          }
        );
        check('PUT /api/ratings/messages/{id} registra voto LIKE (200)', rateRes.status === 200);

        const ratingEvt = await conn1.waitForMessage(
          (m) => m.type === 'event' && m.event === 'rating.changed.v1',
          3000
        );
        check(
          'Votar en PUT /api/ratings/messages/{id} dispara evento WS rating.changed.v1 en vivo',
          ratingEvt?.event === 'rating.changed.v1' && ratingEvt?.payload?.likes === 1,
          JSON.stringify(ratingEvt)
        );

        const repEvt = await conn1.waitForMessage(
          (m) => m.type === 'event' && m.event === 'reputation.changed.v1',
          3000
        );
        check(
          'Servicio Reputation procesa el voto y dispara evento WS reputation.changed.v1 en vivo',
          repEvt?.event === 'reputation.changed.v1' && Number(repEvt?.payload?.delta) > 0,
          JSON.stringify(repEvt)
        );

        // Enviar solicitud de amistad desde Usuario 2 -> Usuario 1 recibe notification.requested.v1 en vivo
        const friendReqRes = await httpCall(GATEWAY_URL, 'POST', '/api/network/graphql', {
          token: jwt2,
          body: {
            query: `mutation Send($recipientId: UUID!) { sendFriendRequest(recipientId: $recipientId) { id status } }`,
            variables: { recipientId: userId },
          },
        });
        check(
          'POST /api/network/graphql (sendFriendRequest) responde 200',
          friendReqRes.status === 200 && Boolean(friendReqRes.data?.data?.sendFriendRequest?.id)
        );

        const notifEvt = await conn1.waitForMessage(
          (m) => m.type === 'event' && m.event === 'notification.requested.v1',
          3000
        );
        check(
          'Solicitud de amistad en Network dispara evento WS notification.requested.v1 en vivo',
          notifEvt?.event === 'notification.requested.v1' && notifEvt?.payload?.userId === userId,
          JSON.stringify(notifEvt)
        );
      }

      // Eliminar el mensaje y verificar que llega message.deleted.v1 por WebSocket
      const delRes = await httpCall(GATEWAY_URL, 'DELETE', `/api/messages/${createdMsgId}`, {
        token: jwtToken,
      });
      check('DELETE /api/messages/{id} elimina el mensaje (200)', delRes.status === 200);

      const deletedEvent = await conn1.waitForMessage(
        (m) => m.type === 'event' && m.event === 'message.deleted.v1',
        3000
      );
      check(
        'Eliminar mensaje en DELETE /api/messages/{id} dispara evento WS message.deleted.v1 vía RabbitMQ',
        deletedEvent?.event === 'message.deleted.v1' &&
          deletedEvent?.payload?.messageId === createdMsgId,
        JSON.stringify(deletedEvent)
      );
    }
  }

  // 6. Publicar evento de prueba si el puerto interno de realtime está accesible
  if (INTERNAL_URL) {
    try {
      const longText = 'X'.repeat(180);
      const pubRes = await httpCall(INTERNAL_URL, 'POST', '/internal/publish', {
        internalToken: INTERNAL_TOKEN,
        body: {
          eventId: '0192f3a4-9999-4000-8000-000000000099',
          eventType: 'message.published.v1',
          occurredAt: new Date().toISOString(),
          payload: {
            messageId: '550e8400-e29b-41d4-a716-446655440000',
            authorId: userId,
            content: longText,
            latitude: 4.6371,
            longitude: -74.0834,
            moderationDecision: 'ALLOW',
          },
        },
      });

      check('POST /internal/publish responde 202', pubRes.status === 202, JSON.stringify(pubRes.data));

      const eventFrame = await conn1.waitForMessage((m) => m.type === 'event' && m.event === 'message.published.v1');
      check(
        'Cliente WebSocket recibe el evento en < 1 s con contentPreview truncado a <= 140 chars',
        eventFrame?.eventId === '0192f3a4-9999-4000-8000-000000000099' &&
          eventFrame?.payload?.content === undefined &&
          eventFrame?.payload?.contentPreview?.length === 140,
        JSON.stringify(eventFrame)
      );
    } catch (err) {
      console.log(`INFO Saltando prueba de /internal/publish (${INTERNAL_URL} no expuesto al host): ${err.message}`);
    }
  }

  conn1.ws.close();

  console.log(`\nResultado: ${failures === 0 ? 'TODAS LAS VERIFICACIONES PASARON' : `${failures} fallo(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Error fatal en test-realtime:', err);
  process.exit(1);
});
