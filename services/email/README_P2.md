# Email — Requisitos Prototipo 2

> Componente pendiente. Envía correos transaccionales en segundo plano a partir de eventos del broker.

## 1. Propósito

Enviar correos de bienvenida y correos genéricos solicitados por otros componentes. El envío siempre ocurre por cola; nunca dentro de la petición HTTP de otro servicio.

## 2. Alcance

**Incluye**

- [ ] Consumir `user.registered.v1` para el correo de bienvenida.
- [ ] Consumir `email.requested.v1` para correos genéricos.
- [ ] Plantillas HTML + texto plano en español.
- [ ] Reintentos, DLQ e idempotencia.
- [ ] Registro de envíos y estado.
- [ ] Endpoint interno para probar envíos.

**No incluye**

- Correos masivos/marketing.
- Seguimiento de aperturas/clics.
- Gestión de rebotes (se puede integrar después).

## 3. Reglas de negocio

- [ ] Solo plantillas registradas; no se acepta HTML arbitrario.
- [ ] Variables escapadas con autoescape.
- [ ] `to` válido, máximo 320 caracteres.
- [ ] `idempotencyKey` ya enviado no se reenvía; se hace ack. Si no viene, usar `emailId`.
- [ ] Reintentos con backoff (10 s, 1 min, 5 min) y luego DLQ.
- [ ] Límite por destinatario: 5 correos/hora (configurable).
- [ ] No registrar cuerpo ni correo completo en logs; enmascarar (`j***@dominio.com`).
- [ ] `replyTo` opcional; por defecto `no-reply@geopicto.org`.
- [ ] Bienvenida: `idempotencyKey = welcome:<userId>`.

## 4. API HTTP

| Método y ruta | Autenticación | Respuesta |
| --- | --- | --- |
| `POST /internal/emails` | `X-Internal-Token` | `202` con `{ "emailId": "...", "status": "QUEUED" }` directo. |
| `GET /internal/emails/{id}` | `X-Internal-Token` | Estado del envío. |
| `GET /health` | — | Estado, BD y SMTP. |

No se publica en el gateway. **Las respuestas exitosas devuelven el dato directo, sin `{ success, data }`.**

## 5. Plantillas

| Template | Variables | Uso |
| --- | --- | --- |
| `welcome` | `username` | Registro. |
| `level-up` | `username`, `level`, `score` | Opcional, si se resuelve el correo. |
| `moderation-warning` | `username`, `messagePreview`, `reason` | Opcional. |
| `moderation-blocked` | `username`, `messagePreview`, `reason` | Opcional. |
| `generic` | `title`, `body`, `ctaUrl?`, `ctaLabel?` | Uso general. |

- [ ] HTML responsive, CSS inline, ancho máximo 600 px.
- [ ] Versión texto plano obligatoria.
- [ ] Asunto ≤ 200 caracteres.
- [ ] Enlaces absolutos; `ctaUrl` solo `http`/`https`.
- [ ] Pie con “GeoPicto”; sin enlaces de baja para transaccionales.

## 6. Modelo de datos (PostgreSQL `email`)

Solo tabla de lógica de negocio. **Sin outbox ni processed_events.**

```sql
CREATE TABLE email_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key     VARCHAR(160) UNIQUE,
  recipient           VARCHAR(320) NOT NULL,
  template            VARCHAR(64) NOT NULL,
  subject             VARCHAR(200) NOT NULL,
  status              VARCHAR(16) NOT NULL DEFAULT 'QUEUED'
                      CHECK (status IN ('QUEUED','SENDING','SENT','FAILED','DLQ')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  provider_message_id VARCHAR(255),
  last_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ
);

CREATE INDEX idx_email_log_status_created ON email_log (status, created_at);
```

- [ ] `last_error` truncado y sin datos sensibles.
- [ ] Retención 30 días configurable.

## 7. Eventos

**Consume**

- `email.user.registered.q` ← `user.registered.v1`: envía `welcome` a `email`, `idempotencyKey = welcome:<userId>`.
- `email.send.q` ← `email.requested.v1`: envía la plantilla solicitada.

**Publica (opcional)**

- `email.sent.v1` / `email.failed.v1`.

```json
{
  "eventId": "0192f3a4-...",
  "eventType": "email.requested.v1",
  "version": 1,
  "occurredAt": "2026-10-24T14:30:00Z",
  "producer": "otro-servicio",
  "correlationId": "b3b1c2d4-...",
  "payload": {
    "emailId": "9f8e...",
    "to": "explorador@geochat.org",
    "template": "generic",
    "subject": "Novedades en GeoPicto",
    "variables": { "title": "Hola", "body": "..." },
    "idempotencyKey": "news:2026-10-24",
    "replyTo": null,
    "requestedAt": "2026-10-24T14:30:00Z"
  }
}
```

## 8. Requisitos no funcionales

- [ ] Encolar y responder < 200 ms; envío asíncrono.
- [ ] p95 de envío < 10 s con SMTP disponible.
- [ ] Reintentos + DLQ; no bloquear la cola.
- [ ] TLS en producción; Mailpit sin TLS en local.
- [ ] Límite global 100 correos/minuto.
- [ ] `/health` verifica SMTP sin enviar correo.

## 9. Consejo técnico

**Recomendado:** Python 3.13 + FastAPI + `aio-pika` + `aiosmtplib` + Jinja2 + SQLAlchemy 2 + PostgreSQL + `structlog`.

- Jinja2 para HTML/texto con autoescape.
- `aiosmtplib` funciona con Mailpit y proveedores SMTP (SES, SendGrid, Mailgun).
- Worker + API mínima de salud/administración.
- Mailpit en Docker (`http://localhost:8025`) para ver correos sin enviar nada real.

**Alternativa:** Go + `wneessen/go-mail` + `html/template` + `amqp091-go`. Más ligero, pero menos cómodo para plantillas.

**Trampas**

- No enviar dentro del request de registro.
- Normalizar email para idempotencia.
- No permitir HTML del productor.
- No loggear cuerpo ni correo completo.
- No reintentar indefinidamente un correo inválido.
- En producción: SPF, DKIM y DMARC.

## 10. Tareas

- [ ] Crear `services/email` con worker, API interna y `templates/`.
- [ ] Migración de `email_log`.
- [ ] Plantillas `welcome` y `generic`.
- [ ] Consumidores de `user.registered` y `email.requested`.
- [ ] Reintentos, DLQ y límites.
- [ ] Mailpit en compose de desarrollo.
- [ ] Tests con Mailpit o `aiosmtpd`.
- [ ] `README.md`, `.env.example`, `Dockerfile`, `docker-compose.yml`.

## 11. Definition of Done

- [ ] Al registrarse llega correo de bienvenida visible en Mailpit.
- [ ] Misma `idempotencyKey` no envía dos veces.
- [ ] Fallo SMTP se reintenta y termina en DLQ.
- [ ] HTML + texto plano.
- [ ] No se registran correos completos en logs.
