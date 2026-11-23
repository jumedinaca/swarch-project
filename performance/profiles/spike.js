/**
 * GeoPicto — Spike Test Profile (Sudden Burst & Recovery)
 *
 * Simulates an abrupt 40x traffic surge (default: 25 -> 1000 -> 25 VUs,
 * configurable up to 2000 VUs via SPIKE_VUS) to evaluate API Gateway / Reverse
 * Proxy stability and post-spike recovery latency.
 *
 * Usage:
 *   k6 run -e BASE_URL=https://localhost -e SPIKE_VUS=1000 performance/profiles/spike.js
 */

import { buildBaseOptions, executeWorkloadIteration } from './common.js';

const BASE_VUS = Number.parseInt(__ENV.BASE_VUS || '25', 10);
const SPIKE_VUS = Number.parseInt(__ENV.SPIKE_VUS || '1000', 10);
const BASE_DURATION = __ENV.BASE_DURATION || '20s';
const SPIKE_DURATION = __ENV.SPIKE_DURATION || '25s';
const RECOVERY_DURATION = __ENV.RECOVERY_DURATION || '40s';

export const options = buildBaseOptions({
  stages: [
    { duration: BASE_DURATION, target: BASE_VUS },       // Phase 1: Baseline steady state
    { duration: '5s', target: SPIKE_VUS },               // Abrupt surge
    { duration: SPIKE_DURATION, target: SPIKE_VUS },     // Phase 2: Sustained spike peak
    { duration: '5s', target: BASE_VUS },                // Abrupt drop
    { duration: RECOVERY_DURATION, target: BASE_VUS },   // Phase 3: Recovery observation
    { duration: '5s', target: 0 },                       // Graceful teardown
  ],
});

export default function () {
  executeWorkloadIteration();
}
