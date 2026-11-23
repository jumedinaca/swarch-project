/**
 * Flujo 3 — Autenticación: POST /api/auth/login (Argon2id)
 *
 * El hash Argon2id es intencionalmente costoso en CPU y memoria: este flujo
 * encuentra el techo de logins/s de auth-service. Rota por todos los usuarios
 * sembrados, alterna usuario/correo y un AUTH_FAIL_RATIO (10 %) de intentos usa
 * contraseña incorrecta (401 esperado, también paga el costo de Argon2).
 *
 *   k6 run performance/scenarios/auth.js
 *   k6 run -e MODE=rate -e RATE=20 -e DURATION=1m performance/scenarios/auth.js
 *
 * Variables: AUTH_FAIL_RATIO=0.1  AUTH_LOGOUT=true (cierra cada sesión creada)
 * Con rate limiting activo (Escenario 4) espere 429: se cuentan aparte.
 */

import { authLogin } from './lib/flows.js';
import { DEFAULT_STAGES, buildOptions, requireSeed, thinkTime } from './lib/workload.js';

export const options = buildOptions({
  defaultStages: DEFAULT_STAGES,
  thresholds: {
    flow_auth_duration: ['p(95)<1500'],
  },
});

export function setup() {
  requireSeed('auth');
  return {};
}

export default function () {
  authLogin();
  thinkTime();
}
