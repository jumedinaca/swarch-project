import http from 'k6/http';
import { sleep, check } from 'k6';

// URI del API Gateway desplegado y endpoint de la funcionalidad seleccionada:
// Busqueda de mensajes cercanos por geolocalizacion (API Gateway -> messages -> PostGIS)
const API_GATEWAY_URI = 'localhost:8080';
const ENDPOINT =
  __ENV.ENDPOINT || '/api/messages/nearby?lat=4.6371&lng=-74.0834&radius=500';

// Permite ejecutar:
// 1) Modo puntual (pasos iv.e.1 y iv.e.3 de la guia: 1 VU o 50 VUs por 30s):
//      k6 run -e MODE=single -e VUS=1  performance/performance_test.js
//      k6 run -e MODE=single -e VUS=50 performance/performance_test.js
// 2) Modo barrido por etapas (paso iv.e.4 de la guia, por defecto):
//      k6 run performance/performance_test.js
export const options =
  __ENV.MODE === 'single'
    ? Number(__ENV.VUS || 1) === 1
      ? {
          vus: 1, // number of concurrent virtual users
          duration: __ENV.DURATION || '30s', // test duration
        }
      : {
          stages: [
            { duration: '2s', target: Number(__ENV.VUS || 50) },
            { duration: __ENV.DURATION || '30s', target: Number(__ENV.VUS || 50) },
          ],
        }
    : {
        stages: [
          { duration: '30s', target: 1 },    // 1 user
          { duration: '30s', target: 50 },   // 50 users
          { duration: '30s', target: 200 },  // 200 users
          { duration: '30s', target: 500 },  // 500 users
          { duration: '30s', target: 2000 }, // 2000 users
          { duration: '30s', target: 0 },    // ramp-down
        ],
      };

export default function () {
  const res = http.get(`http://${API_GATEWAY_URI}${ENDPOINT}`, {
    timeout: __ENV.REQ_TIMEOUT || '380ms',
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
  });

  sleep(1);
}
