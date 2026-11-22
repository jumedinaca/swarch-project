/**
 * GeoPicto — Stress Test Profile (Progressive Saturation up to 2000 VUs)
 *
 * Pushes the system progressively to identify throughput saturation, latency
 * degradation, error onset, and the Knee of the Performance Curve.
 *
 * Modes:
 *   - MODE=single (used by run-performance-suite.sh across 25 100 250 500 1000 2000 VUs):
 *       k6 run -e MODE=single -e VUS=2000 -e DURATION=30s performance/profiles/stress.js
 *   - MODE=ramp (standalone single continuous run up to 2000 VUs):
 *       k6 run performance/profiles/stress.js
 */

import { buildBaseOptions, executeWorkloadIteration } from './common.js';

const MODE = (__ENV.MODE || 'ramp').toLowerCase();
const VUS = Number.parseInt(__ENV.VUS || '200', 10);
const DURATION = __ENV.DURATION || '30s';

export const options =
  MODE === 'single'
    ? buildBaseOptions({
        vus: VUS,
        duration: DURATION,
      })
    : buildBaseOptions({
        stages: [
          { duration: '25s', target: 25 },
          { duration: '25s', target: 100 },
          { duration: '25s', target: 250 },
          { duration: '25s', target: 500 },
          { duration: '30s', target: 1000 },
          { duration: '30s', target: 2000 },
          { duration: '20s', target: 0 },
        ],
      });

export default function () {
  executeWorkloadIteration();
}
