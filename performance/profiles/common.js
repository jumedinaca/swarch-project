/**
 * GeoPicto — Shared k6 Workload Library (Persona 8)
 *
 * Implements the 4 core architectural flows from plan-trabajo-p3.md:
 *   1. nearby_read     — GET  /api/messages/nearby (PostGIS spatial query)
 *   2. write_events    — POST /api/messages & PUT /api/ratings/messages/:id (Write + RabbitMQ + Moderation/Reputation)
 *   3. auth_login      — POST /api/auth/login (Argon2id cryptographic verification)
 *   4. network_graphql — POST /api/network/graphql (GraphQL + MongoDB social graph)
 *
 * Designed for high concurrency (up to 2000+ VUs) with responseType: 'none' to
 * avoid client-side JSON parsing bottlenecks, explicit p(99) stats, TLS skip
 * support for self-signed P3 Reverse Proxy certificates, and separate tracking
 * of HTTP 429 (Rate Limiting) vs real saturation errors (5xx / timeout).
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

export const BASE_URL = (__ENV.BASE_URL || 'https://localhost').replace(/\/+$/, '');
export const FLOW_MODE = (__ENV.FLOW || 'mixed').toLowerCase();
export const REQ_TIMEOUT = __ENV.REQ_TIMEOUT || '5s';
export const THINK_TIME = Number.parseFloat(__ENV.THINK_TIME ?? '1.0');
export const INSECURE_TLS = (__ENV.INSECURE_TLS || 'true').toLowerCase() !== 'false';

// Always include p(99) in k6 summary export (k6 omits p(99) by default!)
export const SUMMARY_TREND_STATS = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'];

// Custom per-flow latency trends (ms) & request counters
export const flowNearbyDuration = new Trend('flow_nearby_duration', true);
export const flowWriteDuration = new Trend('flow_write_duration', true);
export const flowAuthDuration = new Trend('flow_auth_duration', true);
export const flowGraphqlDuration = new Trend('flow_graphql_duration', true);

export const flowNearbyReqs = new Counter('flow_nearby_reqs');
export const flowWriteReqs = new Counter('flow_write_reqs');
export const flowAuthReqs = new Counter('flow_auth_reqs');
export const flowGraphqlReqs = new Counter('flow_graphql_reqs');

// Separate Rate Limiting (429) from real server/transport errors (5xx / timeout / connection reset)
export const http429Responses = new Counter('http_429_responses');
export const http5xxOrTimeout = new Counter('http_5xx_or_timeout');
export const realErrorRate = new Rate('real_error_rate');
export const rateLimitedRate = new Rate('rate_limited_rate');

// Load seeded users/messages manifest if available
let SEED = { users: [], messages: [] };
try {
  const raw = open('../.seed-manifest.json');
  const parsed = JSON.parse(raw);
  if (parsed && Array.isArray(parsed.users)) {
    SEED = parsed;
  }
} catch (_) {
  // Manifest absent: script still runs nearby_read safely without crashing
}

const CENTER_LAT = 4.6371;
const CENTER_LNG = -74.0834;
const RADII = [250, 500, 750, 1000];

const GRAPHQL_QUERY = JSON.stringify({
  query: '{ me friends { otherUserId status } incomingRequests { id } outgoingRequests { id } }',
  variables: {},
});

function pickUser() {
  if (!SEED.users || SEED.users.length === 0) return null;
  const idx = (__VU + __ITER) % SEED.users.length;
  return SEED.users[idx];
}

function pickRateableMessage(userId) {
  if (!SEED.messages || SEED.messages.length === 0) return null;
  const len = SEED.messages.length;
  const start = (__VU * 7 + __ITER) % len;
  for (let offset = 0; offset < len; offset += 1) {
    const candidate = SEED.messages[(start + offset) % len];
    if (candidate && candidate.id && candidate.authorId !== userId) {
      return candidate;
    }
  }
  return null;
}

function recordOutcome(res, flowTrend, flowCounter, expectedStatuses) {
  const is429 = res.status === 429;
  const is5xxOrTimeout = res.status === 0 || res.status >= 500 || res.status === 408;
  // Count any unexpected non-429 status (including 401/403/400/404) as a real error
  const isRealErr = is5xxOrTimeout || (!is429 && !expectedStatuses.includes(res.status));

  flowTrend.add(res.timings.duration);
  flowCounter.add(1);
  rateLimitedRate.add(is429);
  realErrorRate.add(isRealErr);

  if (is429) {
    http429Responses.add(1);
  }
  if (is5xxOrTimeout) {
    http5xxOrTimeout.add(1);
  }

  check(res, {
    'status is expected (or 429 if rate-limited)': (r) =>
      expectedStatuses.includes(r.status) || r.status === 429,
    'no 5xx or network timeout': (r) => r.status !== 0 && r.status < 500 && r.status !== 408,
  });
}

// Flow 1: PostGIS geospatial read
export function runNearbyRead() {
  const latJitter = (((__VU * 13 + __ITER) % 21) - 10) * 0.00012;
  const lngJitter = (((__VU * 17 + __ITER) % 21) - 10) * 0.00012;
  const lat = (CENTER_LAT + latJitter).toFixed(5);
  const lng = (CENTER_LNG + lngJitter).toFixed(5);
  const radius = RADII[(__VU + __ITER) % RADII.length];

  const res = http.get(
    `${BASE_URL}/api/messages/nearby?lat=${lat}&lng=${lng}&radius=${radius}`,
    {
      timeout: REQ_TIMEOUT,
      responseType: 'none',
      tags: { flow: 'nearby_read', name: 'GET /api/messages/nearby' },
    }
  );
  recordOutcome(res, flowNearbyDuration, flowNearbyReqs, [200]);
}

// Flow 2: Write + Async RabbitMQ events (POST /api/messages & PUT /api/ratings/messages/:id)
export function runWriteEvents() {
  const user = pickUser();
  if (!user) {
    runNearbyRead();
    return;
  }

  const doRating = ((__VU + __ITER) % 2 === 1);
  const rateable = doRating ? pickRateableMessage(user.id) : null;

  if (rateable) {
    const voteValue = ((__ITER % 2) === 0) ? 'LIKE' : 'DISLIKE';
    const res = http.put(
      `${BASE_URL}/api/ratings/messages/${rateable.id}`,
      JSON.stringify({ value: voteValue }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        timeout: REQ_TIMEOUT,
        responseType: 'none',
        tags: { flow: 'write_events', name: 'PUT /api/ratings/messages/:id' },
      }
    );
    recordOutcome(res, flowWriteDuration, flowWriteReqs, [200]);
    return;
  }

  const lat = Number((CENTER_LAT + (((__VU % 15) - 7) * 0.00015)).toFixed(6));
  const lng = Number((CENTER_LNG + (((__ITER % 15) - 7) * 0.00015)).toFixed(6));

  const res = http.post(
    `${BASE_URL}/api/messages`,
    JSON.stringify({
      content: `Perf VU${__VU}-IT${__ITER}: geospatial load message`,
      latitude: lat,
      longitude: lng,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.token}`,
      },
      timeout: REQ_TIMEOUT,
      responseType: 'none',
      tags: { flow: 'write_events', name: 'POST /api/messages' },
    }
  );
  recordOutcome(res, flowWriteDuration, flowWriteReqs, [201]);
}

// Flow 3: Authentication + Argon2id verification
export function runAuthLogin() {
  const user = pickUser();
  if (!user) {
    runNearbyRead();
    return;
  }

  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({
      usernameOrEmail: user.email,
      password: user.password,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: REQ_TIMEOUT,
      responseType: 'none',
      tags: { flow: 'auth_login', name: 'POST /api/auth/login' },
    }
  );
  recordOutcome(res, flowAuthDuration, flowAuthReqs, [200]);
}

// Flow 4: Social Graph via GraphQL + MongoDB
export function runNetworkGraphql() {
  const user = pickUser();
  if (!user) {
    runNearbyRead();
    return;
  }

  const res = http.post(`${BASE_URL}/api/network/graphql`, GRAPHQL_QUERY, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${user.token}`,
    },
    timeout: REQ_TIMEOUT,
    responseType: 'none',
    tags: { flow: 'network_graphql', name: 'POST /api/network/graphql' },
  });
  recordOutcome(res, flowGraphqlDuration, flowGraphqlReqs, [200]);
}

/**
 * Dispatches one workload iteration based on FLOW env var:
 *   - mixed (default): 50% nearby_read, 20% network_graphql, 20% write_events, 10% auth_login
 *   - nearby | write | auth | graphql: isolated single-flow profiling
 */
export function executeWorkloadIteration() {
  if (FLOW_MODE === 'nearby') {
    runNearbyRead();
  } else if (FLOW_MODE === 'write') {
    runWriteEvents();
  } else if (FLOW_MODE === 'auth') {
    runAuthLogin();
  } else if (FLOW_MODE === 'graphql') {
    runNetworkGraphql();
  } else {
    const r = Math.random();
    if (r < 0.50) {
      runNearbyRead();
    } else if (r < 0.70) {
      runNetworkGraphql();
    } else if (r < 0.90) {
      runWriteEvents();
    } else {
      runAuthLogin();
    }
  }

  if (THINK_TIME > 0) {
    // Small +/- 20% jitter avoids artificial thundering-herd alignment at 2000 VUs
    const jitter = THINK_TIME * (0.8 + Math.random() * 0.4);
    sleep(jitter);
  }
}

export function buildBaseOptions(extra = {}) {
  return {
    insecureSkipTLSVerify: INSECURE_TLS,
    summaryTrendStats: SUMMARY_TREND_STATS,
    noConnectionReuse: false,
    userAgent: 'GeoPicto-k6-PerformanceSuite/P3',
    ...extra,
  };
}
