#!/usr/bin/env node
/**
 * GeoPicto — Idempotent Performance Test Data Seeder (Fallback for Persona 8)
 *
 * Seeds realistic test users, published geolocated messages (in PostGIS and
 * propagated via RabbitMQ to rating-db), and friendships (in MongoDB via GraphQL)
 * so that all 4 performance flows exercise real production code paths.
 *
 * Output: performance/.seed-manifest.json
 *
 * Usage:
 *   BASE_URL=https://localhost node performance/profiles/seed-fallback.mjs
 *   SEED_USERS=25 SEED_MESSAGES=80 BASE_URL=http://localhost:8080 node performance/profiles/seed-fallback.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = (process.env.BASE_URL || 'https://localhost').replace(/\/+$/, '');
const SEED_USERS = Math.max(4, Number.parseInt(process.env.SEED_USERS || '20', 10));
const SEED_MESSAGES = Math.max(10, Number.parseInt(process.env.SEED_MESSAGES || '60', 10));
const PASSWORD = process.env.SEED_PASSWORD || 'PerfTest123!';
const MANIFEST_PATH = process.env.SEED_MANIFEST || path.resolve(__dirname, '..', '.seed-manifest.json');

// Allow self-signed / local CA TLS certificates when testing against https://localhost
if (BASE_URL.startsWith('https://') && process.env.INSECURE_TLS !== 'false') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const CENTER_LAT = 4.6371;
const CENTER_LNG = -74.0834;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiCall(method, urlPath, { token, body, retries = 3 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await fetch(`${BASE_URL}${urlPath}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429 && attempt < retries) {
      const retryAfterSec = Number.parseFloat(res.headers.get('retry-after') || '2');
      const waitMs = Math.min(Math.max(retryAfterSec * 1000, 500), 10000);
      await sleep(waitMs);
      continue;
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }
  return { status: 429, data: null };
}

async function ensureUser(index) {
  const pad = String(index).padStart(2, '0');
  const username = `perfuser_${pad}`;
  const email = `${username}@geopicto.org`;

  const reg = await apiCall('POST', '/api/auth/register', {
    body: { username, email, password: PASSWORD },
  });

  if (reg.status === 201 && reg.data?.data?.token) {
    return {
      id: reg.data.data.user.id,
      username,
      email,
      password: PASSWORD,
      token: reg.data.data.token,
    };
  }

  // User already exists (409) -> log in to obtain fresh token
  const login = await apiCall('POST', '/api/auth/login', {
    body: { usernameOrEmail: email, password: PASSWORD },
  });

  if (login.status === 200 && login.data?.data?.token) {
    return {
      id: login.data.data.user.id,
      username,
      email,
      password: PASSWORD,
      token: login.data.data.token,
    };
  }

  throw new Error(
    `Failed to register or login ${username} (register=${reg.status}, login=${login.status}). ` +
      'If RATE_LIMIT_ENABLED=true is active, run seeding with RATE_LIMIT_ENABLED=false or fewer users.'
  );
}

async function seedFriendships(users) {
  let created = 0;
  const maxPairs = Math.min(users.length - 1, 15);

  for (let i = 0; i < maxPairs; i += 1) {
    const alice = users[i];
    const bob = users[(i + 1) % users.length];

    const sendRes = await apiCall('POST', '/api/network/graphql', {
      token: alice.token,
      body: {
        query: 'mutation($id: UUID!) { sendFriendRequest(recipientId: $id) { id status } }',
        variables: { id: bob.id },
      },
    });

    const reqId = sendRes.data?.data?.sendFriendRequest?.id;
    if (reqId) {
      const acceptRes = await apiCall('POST', '/api/network/graphql', {
        token: bob.token,
        body: {
          query: 'mutation($id: ID!) { acceptFriendRequest(id: $id) { status } }',
          variables: { id: reqId },
        },
      });
      if (acceptRes.data?.data?.acceptFriendRequest?.status === 'ACCEPTED') {
        created += 1;
      }
    }
  }
  return created;
}

async function seedMessages(users) {
  // First check how many published messages already exist around Plaza Che
  const existing = await apiCall(
    'GET',
    `/api/messages/nearby?lat=${CENTER_LAT}&lng=${CENTER_LNG}&radius=800`
  );

  const userIds = new Set(users.map((u) => u.id));
  const existingSeeded = Array.isArray(existing.data)
    ? existing.data
        .filter((m) => m?.id && m?.sender_id && userIds.has(m.sender_id))
        .map((m) => ({
          id: m.id,
          authorId: m.sender_id,
          lat: m.location?.latitude ?? m.latitude ?? CENTER_LAT,
          lng: m.location?.longitude ?? m.longitude ?? CENTER_LNG,
        }))
    : [];

  if (existingSeeded.length >= SEED_MESSAGES) {
    console.log(`[seed] Reusing ${existingSeeded.length} already-published messages.`);
    return existingSeeded.slice(0, SEED_MESSAGES);
  }

  const needed = SEED_MESSAGES - existingSeeded.length;
  const createdIds = [];
  console.log(`[seed] Publishing ${needed} geolocated messages around UNAL campus...`);

  for (let i = 0; i < needed; i += 1) {
    const author = users[i % users.length];
    const row = Math.floor(i / 10) - 3;
    const col = (i % 10) - 5;
    const lat = Number((CENTER_LAT + row * 0.00022).toFixed(6));
    const lng = Number((CENTER_LNG + col * 0.00022).toFixed(6));

    const res = await apiCall('POST', '/api/messages', {
      token: author.token,
      body: {
        content: `GeoPicto performance benchmark note #${i + 1} near Plaza Che`,
        latitude: lat,
        longitude: lng,
      },
    });

    if (res.status === 201 && res.data?.id) {
      createdIds.push({ id: res.data.id, authorId: author.id, lat, lng });
    }
  }

  // Wait for moderation + RabbitMQ publication so messages appear in PostGIS and rating projection
  const targetMin = Math.min(SEED_MESSAGES, existingSeeded.length + Math.max(1, Math.floor(createdIds.length * 0.8)));
  let publishedPool = [...existingSeeded];

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const check = await apiCall(
      'GET',
      `/api/messages/nearby?lat=${CENTER_LAT}&lng=${CENTER_LNG}&radius=1000`
    );
    if (check.status === 200 && Array.isArray(check.data)) {
      publishedPool = check.data
        .filter((m) => m?.id && m?.sender_id && userIds.has(m.sender_id))
        .map((m) => ({
          id: m.id,
          authorId: m.sender_id,
          lat: m.location?.latitude ?? m.latitude ?? CENTER_LAT,
          lng: m.location?.longitude ?? m.longitude ?? CENTER_LNG,
        }));
      if (publishedPool.length >= targetMin) {
        break;
      }
    }
    await sleep(1000);
  }

  // Give RabbitMQ a brief buffer so rating-service projection consumes message.published.v1
  await sleep(1500);
  return publishedPool.length > 0 ? publishedPool : createdIds;
}

async function main() {
  console.log(`[seed] Target BASE_URL: ${BASE_URL}`);
  console.log(`[seed] Preparing ${SEED_USERS} users and ${SEED_MESSAGES} geolocated messages...`);

  const users = [];
  for (let i = 1; i <= SEED_USERS; i += 1) {
    const user = await ensureUser(i);
    users.push(user);
  }
  console.log(`[seed] Users ready: ${users.length}`);

  const friendshipsCreated = await seedFriendships(users);
  console.log(`[seed] Friendships ensured (+${friendshipsCreated} newly accepted).`);

  const messages = await seedMessages(users);
  console.log(`[seed] Published messages ready for nearby & rating flows: ${messages.length}`);

  const manifest = {
    baseUrl: BASE_URL,
    createdAt: new Date().toISOString(),
    users,
    messages,
  };

  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`[seed] Manifest written to ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error(`[seed] ERROR: ${err.message}`);
  process.exit(1);
});
