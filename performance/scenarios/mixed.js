/**
 * Carga mixta — los 4 flujos a la vez, como en producción
 *
 * Mix por defecto (MIX): 50 % nearby, 20 % graphql, 20 % write, 10 % auth,
 * el mismo reparto que profiles/common.js de la Persona 8.
 *
 * Respeta FLOW (mixed | nearby | write | auth | graphql), así que sirve como
 * reemplazo directo de profiles/load.js y profiles/stress.js en la suite:
 *
 *   CUSTOM_K6_SCRIPT=performance/scenarios/mixed.js \
 *     ./performance/run-performance-suite.sh --label p3-p7 --profiles "load stress"
 *
 *   k6 run performance/scenarios/mixed.js
 *   k6 run -e MIX="nearby:70,graphql:20,write:10" performance/scenarios/mixed.js
 */

import { authLogin, nearbyRead, networkGraphql, writeEvents } from './lib/flows.js';
import {
  DEFAULT_STAGES,
  FLOW_MODE,
  buildOptions,
  refreshTokensIfNeeded,
  requireSeed,
  thinkTime,
  weightedChoice,
} from './lib/workload.js';

const FLOWS = {
  nearby: () => nearbyRead(),
  write: (data) => writeEvents(data),
  auth: () => authLogin(),
  graphql: (data) => networkGraphql(data),
};
const MIX = __ENV.MIX || 'nearby:50,graphql:20,write:20,auth:10';

if (FLOW_MODE !== 'mixed' && !FLOWS[FLOW_MODE]) {
  throw new Error(`FLOW='${FLOW_MODE}' no es válido: usa mixed | ${Object.keys(FLOWS).join(' | ')}`);
}

export const options = buildOptions({
  defaultStages: DEFAULT_STAGES,
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    flow_nearby_duration: ['p(95)<800'],
    flow_graphql_duration: ['p(95)<800'],
    flow_write_duration: ['p(95)<1000'],
    flow_auth_duration: ['p(95)<1500'],
  },
});

export function setup() {
  requireSeed('mixed');
  return refreshTokensIfNeeded();
}

export default function (data) {
  const flow = FLOW_MODE === 'mixed' ? weightedChoice(MIX) : FLOW_MODE;
  (FLOWS[flow] || FLOWS.nearby)(data);
  thinkTime();
}
