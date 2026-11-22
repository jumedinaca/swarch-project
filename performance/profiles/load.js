/**
 * GeoPicto — Load Test Profile (Nominal Sustained Concurrency)
 *
 * Evaluates steady-state response times (p50, p90, p95, p99), throughput (RPS),
 * and error rates across nominal concurrency tiers (default: 25 -> 50 -> 100 VUs).
 *
 * Modes:
 *   - MODE=single (used by run-performance-suite.sh for clean per-VU summaries):
 *       k6 run -e MODE=single -e VUS=50 -e DURATION=30s performance/profiles/load.js
 *   - MODE=stages (standalone run):
 *       k6 run performance/profiles/load.js
 */

import { buildBaseOptions, executeWorkloadIteration } from './common.js';

const MODE = (__ENV.MODE || 'stages').toLowerCase();
const VUS = Number.parseInt(__ENV.VUS || '50', 10);
const DURATION = __ENV.DURATION || '30s';

export const options =
  MODE === 'single'
    ? buildBaseOptions({
        vus: VUS,
        duration: DURATION,
      })
    : buildBaseOptions({
        stages: [
          { duration: '30s', target: 25 },
          { duration: '30s', target: 50 },
          { duration: '30s', target: 100 },
          { duration: '15s', target: 0 },
        ],
      });

export default function () {
  executeWorkloadIteration();
}
