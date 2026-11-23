# Resultados por flujo — p7-p3-flows

Destino: `https://localhost`

| Flujo | Carga | Req | RPS | p50 | p90 | p95 | p99 | Error real | 429 | Checks |
| :-- | :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| Flujo 1 — Nearby (PostGIS) | 50 VUs | 1512 | 48.75 | 3.97 ms | 25.53 ms | 39.95 ms | 128.22 ms | 0 % | 0 % | 100 % |
| Flujo 2 — Escritura + RabbitMQ | 50 VUs | 1512 | 48.51 | 2.98 ms | 4.32 ms | 6.43 ms | 44.55 ms | 0 % | 0 % | 100 % |
| Flujo 3 — Login (Argon2id) | 50 VUs | 1344 | 43.2 | 110.15 ms | 218.58 ms | 268.07 ms | 929.6 ms | 0 % | 0 % | 100 % |
| Flujo 4 — GraphQL + MongoDB | 50 VUs | 1515 | 48.76 | 5.71 ms | 10.07 ms | 14.59 ms | 172.15 ms | 0 % | 0 % | 100 % |
| Mixto (50/20/20/10) | 50 VUs | 1503 | 48.47 | 4.99 ms | 32.17 ms | 42.03 ms | 69.85 ms | 0 % | 0 % | 100 % |

## Métricas específicas

- **Flujo 1 — Nearby (PostGIS):** resultados por consulta: media 752.7, p95 4117.2; payload medio 302.1 KB.
- **Flujo 2 — Escritura + RabbitMQ:** POST /messages p95 5.46 ms; PUT /ratings p95 6.97 ms; publicación asíncrona (moderación vía RabbitMQ): p50 254 ms, p95 255 ms.
- **Flujo 3 — Login (Argon2id):** login correcto p95 264.7 ms; login rechazado p95 363.05 ms.
- **Flujo 4 — GraphQL + MongoDB:** errores GraphQL 0 %.
- **Mixto (50/20/20/10):** resultados por consulta: media 723.6, p95 3091.3; payload medio 290.5 KB; POST /messages p95 6.46 ms; PUT /ratings p95 14.02 ms; login correcto p95 144.94 ms; login rechazado p95 55.55 ms; errores GraphQL 0 %; nearby p95 42.72 ms; write p95 7.38 ms; auth p95 137.05 ms; graphql p95 11.83 ms.

_Error real_ = timeouts, 408 y 5xx. Los 429 (rate limiting) se reportan aparte porque son una defensa, no saturación.
