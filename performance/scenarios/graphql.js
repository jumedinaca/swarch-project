/**
 * Flujo 4 — Grafo social: POST /api/network/graphql (GraphQL + MongoDB)
 *
 * Tres operaciones de lectura con el mix GRAPHQL_MIX:
 *   dashboard   (50 %) me + friends + incomingRequests + outgoingRequests
 *   friendsPage (30 %) friends(limit: 50) con todos los campos
 *   requests    (20 %) solicitudes pendientes entrantes y salientes
 * Los errores de GraphQL (HTTP 200 con "errors") se miden en graphql_error_rate.
 *
 *   k6 run performance/scenarios/graphql.js
 *   k6 run -e MODE=single -e VUS=200 -e DURATION=1m performance/scenarios/graphql.js
 *
 * Requiere: node performance/seed-data.mjs (usuarios y amistades).
 */

import { networkGraphql } from './lib/flows.js';
import { DEFAULT_STAGES, buildOptions, refreshTokensIfNeeded, requireSeed, thinkTime } from './lib/workload.js';

export const options = buildOptions({
  defaultStages: DEFAULT_STAGES,
  thresholds: {
    flow_graphql_duration: ['p(95)<800', 'p(99)<2000'],
    graphql_error_rate: ['rate<0.01'],
  },
});

export function setup() {
  requireSeed('graphql');
  return refreshTokensIfNeeded();
}

export default function (data) {
  networkGraphql(data);
  thinkTime();
}
