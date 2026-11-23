/**
 * Flujo 2 — Escritura + eventos asíncronos (RabbitMQ)
 *
 *   POST /api/messages              -> messages-db + message.created -> moderation
 *   PUT  /api/ratings/messages/:id  -> rating-db + evento -> reputation
 *
 * Por defecto mitad y mitad (WRITE_POST_RATIO=0.5). Con ASYNC_PROBE_RATE > 0
 * una fracción de los mensajes creados se sondea hasta que la moderación los
 * publica, y se reporta message_publish_latency: el tiempo real del pipeline
 * asíncrono, que el 201 del POST no muestra.
 *
 *   k6 run performance/scenarios/write.js
 *   k6 run -e MODE=single -e VUS=100 -e DURATION=1m -e ASYNC_PROBE_RATE=0.05 performance/scenarios/write.js
 *
 * Requiere: node performance/seed-data.mjs (usuarios y mensajes calificables).
 */

import { writeEvents } from './lib/flows.js';
import { DEFAULT_STAGES, buildOptions, refreshTokensIfNeeded, requireSeed, thinkTime } from './lib/workload.js';

export const options = buildOptions({
  defaultStages: DEFAULT_STAGES,
  thresholds: {
    flow_write_duration: ['p(95)<1000', 'p(99)<2500'],
    message_publish_latency: ['p(95)<5000'],
  },
});

export function setup() {
  requireSeed('write');
  return refreshTokensIfNeeded();
}

export default function (data) {
  writeEvents(data);
  thinkTime();
}
