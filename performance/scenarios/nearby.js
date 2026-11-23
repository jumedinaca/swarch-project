/**
 * Flujo 1 — Lectura geoespacial: GET /api/messages/nearby (PostGIS)
 *
 * Simula usuarios abriendo el mapa: 80 % cerca de un hotspot sembrado, 10 % en
 * zonas sin actividad y 10 % en cualquier punto de la ciudad, con radios de
 * 100 m a 2 km. La consulta no pagina, así que la latencia depende de cuántos
 * mensajes caen en el radio: ver nearby_results_count y nearby_payload_bytes
 * (por tag radius).
 *
 *   k6 run performance/scenarios/nearby.js
 *   k6 run -e MODE=single -e VUS=200 -e DURATION=1m performance/scenarios/nearby.js
 *   k6 run -e MODE=rate -e RATE=300 -e DURATION=2m performance/scenarios/nearby.js
 *
 * Variables: NEARBY_RADII="250:50,1000:50"  NEARBY_HOTSPOT_RATIO=0.8
 *            NEARBY_SPARSE_RATIO=0.1  NEARBY_BODY_SAMPLE=0.1
 */

import { nearbyRead } from './lib/flows.js';
import { DEFAULT_STAGES, buildOptions, thinkTime } from './lib/workload.js';

export const options = buildOptions({
  defaultStages: DEFAULT_STAGES,
  thresholds: {
    flow_nearby_duration: ['p(95)<800', 'p(99)<2000'],
  },
});

export default function () {
  nearbyRead();
  thinkTime();
}
