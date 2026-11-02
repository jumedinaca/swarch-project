#!/usr/bin/env node
/**
 * Script interactivo para demostrar eventos en tiempo real en vivo (Web y Expo Go en celular).
 *
 * Uso:
 *   node scripts/demo-realtime.mjs
 *   node scripts/demo-realtime.mjs --user <USER_ID>
 *
 * Si no se pasa --user, emite al tópico "global" para que TODOS los dispositivos
 * conectados (navegador web y celular con Expo Go) reciban los Toasts al instante.
 */

import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const targetUser = getArg('--user', 'global');

const demoEvents = [
  {
    label: '1/4  Nueva PictoNota publicada en el mapa (message.published.v1)',
    body: {
      event: 'message.published.v1',
      payload: {
        messageId: `demo-msg-${Date.now()}`,
        authorId: 'user-luigi-ds',
        contentPreview: '¡PictoNota en vivo desde Elixir Socket Gateway!',
        latitude: 4.6382,
        longitude: -74.0841,
        moderationDecision: 'ALLOW',
      },
    },
  },
  {
    label: '2/4  Subida de nivel y reputación (reputation.changed.v1)',
    body: {
      event: 'reputation.changed.v1',
      payload: {
        userId: targetUser,
        score: 150,
        delta: 25,
        level: 'Explorador',
        levelChanged: true,
      },
    },
  },
  {
    label: '3/4  Notificación social en vivo (notification.requested.v1)',
    body: {
      event: 'notification.requested.v1',
      payload: {
        userId: targetUser,
        title: 'Nuevo amigo en GeoPicto',
        body: '@PeachDS aceptó tu solicitud de amistad.',
      },
    },
  },
  {
    label: '4/4  Resultado de moderación automática (moderation.completed.v1)',
    body: {
      event: 'moderation.completed.v1',
      payload: {
        authorId: targetUser,
        messageId: 'demo-msg-mod-1',
        decision: 'ALLOW',
      },
    },
  },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function publishInsideContainer(eventEnvelope) {
  const json = JSON.stringify(eventEnvelope);
  const out = execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'socket-gateway',
      'wget',
      '-qO-',
      '--header=Content-Type: application/json',
      '--header=X-Internal-Token: dev-internal-token',
      `--post-data=${json}`,
      'http://127.0.0.1:8080/internal/publish',
    ],
    { encoding: 'utf-8' }
  );
  return JSON.parse(out);
}

async function main() {
  console.log('========================================================');
  console.log(' Demo en Vivo — GeoPicto Realtime (Web + Expo Go Móvil)');
  console.log(` Destino: ${targetUser === 'global' ? 'Todos los dispositivos conectados (global)' : `user:${targetUser}`}`);
  console.log('========================================================\n');

  for (const item of demoEvents) {
    console.log(`-> Enviando: ${item.label}`);
    try {
      const res = publishInsideContainer(item.body);
      console.log(`   Publicado OK (eventId: ${res.eventId}, topics: ${res.topics.join(', ')})\n`);
    } catch (err) {
      console.error(`   Error al publicar evento: ${err.message}\n`);
    }
    await sleep(2800);
  }

  console.log('Demo finalizada. Revisa los banners en tu celular o navegador.');
}

main();
