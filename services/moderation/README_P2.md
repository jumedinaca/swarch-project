# Moderation — Requisitos Prototipo 2

> Componente pendiente. Analiza los mensajes que gestiona `messages` y decide si se publican, se publican con advertencia o se bloquean.
>
> **Decisión de P2:** la moderación usa un **modelo de machine learning** además de reglas determinísticas. El modelo se sirve desde Python.

## 1. Propósito

Consumir los mensajes recién creados, evaluar su contenido con un modelo ML y reglas de seguridad, y responder al broker con una decisión (`ALLOW`, `WARN`, `BLOCK`) y las razones. Deja auditoría de cada decisión.

## 2. Alcance

**Incluye**

- [ ] Consumir `message.submitted.v1` y `message.edited.v1`.
- [ ] Modelo ML de clasificación de texto (3 clases: `ALLOW`, `WARN`, `BLOCK`).
- [ ] Reglas determinísticas para casos duros (amenazas, doxxing, contenido ilegal, enlaces).
- [ ] Escalamiento por historial del autor.
- [ ] Persistencia de la decisión, confianza, versión del modelo y latencia.
- [ ] Publicación de `moderation.completed.v1` y `moderation.failed.v1`.
- [ ] Endpoint interno síncrono para pruebas.

**No incluye**

- UI de moderación humana.
- Borrado/edición de mensajes (lo hace `messages`).
- Notificaciones/correos (los maneja `socket-gateway`/`email`).

## 3. Reglas de negocio

- [ ] Normalizar el texto antes de evaluar: minúsculas, Unicode NFKC, quitar acentos, colapsar espacios, quitar caracteres de ancho cero y mapear leetspeak básico.
- [ ] El modelo recibe el texto normalizado (máximo 2000 caracteres) y devuelve `decision`, `confidence` y probabilidades por clase.
- [ ] Reglas duras independientes del modelo:
  - `BLOCK` para amenazas explícitas, doxxing, contenido ilegal o términos de severidad alta.
  - `WARN` para spam de enlaces, repetición excesiva o mayúsculas sostenidas.
- [ ] Combinación híbrida:
  - Si una regla dura da `BLOCK`, se bloquea aunque el modelo diga `ALLOW`.
  - Si el modelo da `BLOCK` con confianza ≥ `BLOCK_THRESHOLD` (por defecto 0.80), se bloquea.
  - Si el modelo da `WARN` con confianza ≥ `WARN_THRESHOLD` (por defecto 0.60), se advierte.
  - En caso contrario, `ALLOW`.
- [ ] Escalamiento: 3 `WARN` en 24 h → siguiente mensaje `BLOCK`; 1 `BLOCK` en 24 h → siguiente `WARN` se convierte en `BLOCK`.
- [ ] Idempotencia por `(messageId, messageVersion)`: la restricción única de la tabla de decisiones evita duplicados.
- [ ] No registrar el contenido del mensaje en logs; solo `messageId`, `authorId`, decisión, confianza y razones.
- [ ] Si el modelo no carga o falla, usar solo reglas y marcar `degraded = true`; no bloquear el servicio.

## 4. API HTTP

| Método y ruta | Autenticación | Respuesta |
| --- | --- | --- |
| `POST /internal/moderate` | `X-Internal-Token` | Decisión directa. Body `{ messageId, authorId, content, messageVersion }`. Solo pruebas/pre-check. |
| `GET /internal/decisions/{messageId}` | `X-Internal-Token` | Última decisión. |
| `GET /moderation/decisions?decision=&limit=&cursor=` | JWT (opcional) | Auditoría. No exponer sin roles. |
| `GET /health` | — | Estado, BD, broker y modelo ML. |

**Las respuestas exitosas devuelven directamente el dato, sin `{ success, data }`.**

```json
{
  "messageId": "550e8400-...",
  "messageVersion": 1,
  "decision": "WARN",
  "confidence": 0.71,
  "reasons": ["PROFANITY_LOW", "EXCESSIVE_LINKS"],
  "modelVersion": "tfidf-logreg-2026-10-24",
  "ruleVersion": "2026-10-24.1",
  "degraded": false,
  "latencyMs": 42
}
```

Errores: `{ "error": "codigo", "message": "texto" }`.

## 5. Modelo de datos (PostgreSQL `moderation`)

Solo tabla de lógica de negocio. **Sin outbox ni processed_events.**

```sql
CREATE TABLE moderation_decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL,
  message_version INTEGER NOT NULL DEFAULT 1,
  author_id       UUID NOT NULL,
  decision        VARCHAR(16) NOT NULL CHECK (decision IN ('ALLOW','WARN','BLOCK','REVIEW')),
  confidence      NUMERIC(5,4),
  reasons         JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_version   VARCHAR(64),
  rule_version    VARCHAR(32) NOT NULL,
  degraded        BOOLEAN NOT NULL DEFAULT false,
  latency_ms      INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, message_version)
);

CREATE INDEX idx_moderation_author_created
  ON moderation_decisions (author_id, created_at DESC);
```

- [ ] `reasons` usa códigos estables: `PROFANITY_HIGH`, `THREAT`, `DOXXING`, `SPAM_LINKS`, `REPEATED_CONTENT`, `EXCESSIVE_CAPS`, `MODEL_BLOCK`, `MODEL_WARN`, `OK`, `MODEL_UNAVAILABLE`.
- [ ] `model_version` permite reproducir una decisión.
- [ ] Reglas en `rules/moderation.yaml` versionado.

## 6. Eventos

**Consume**

- `moderation.message.submitted.q` ← `message.submitted.v1`.
- `moderation.message.edited.q` ← `message.edited.v1`.

**Publica**

- `moderation.completed.v1`.
- `moderation.failed.v1` si no se pudo analizar después de los reintentos.

```json
{
  "eventId": "0192f3a4-...",
  "eventType": "moderation.completed.v1",
  "version": 1,
  "occurredAt": "2026-10-24T14:31:00Z",
  "producer": "moderation",
  "correlationId": "b3b1c2d4-...",
  "causationId": "a1a1a1a1-...",
  "payload": {
    "messageId": "550e8400-...",
    "authorId": "7b8339ec-...",
    "messageVersion": 1,
    "decision": "WARN",
    "confidence": 0.71,
    "reasons": ["PROFANITY_LOW", "EXCESSIVE_LINKS"],
    "modelVersion": "tfidf-logreg-2026-10-24",
    "ruleVersion": "2026-10-24.1",
    "degraded": false,
    "decidedAt": "2026-10-24T14:31:00Z"
  }
}
```

Flujo con `messages`:

1. `messages` inserta `PENDING` y publica `message.submitted.v1`.
2. `moderation` decide y publica `moderation.completed.v1`.
3. `messages` aplica:
   - `ALLOW` → `PUBLISHED`, publica `message.published.v1`.
   - `WARN` → `PUBLISHED` con `moderation_status = WARN`, publica `message.published.v1`.
   - `BLOCK` → `BLOCKED`, no publica.
   - `REVIEW` → queda pendiente (si se usa).
4. `socket-gateway` notifica al autor.

## 7. Requisitos no funcionales

- [ ] p95 < 300 ms con modelo lineal; < 2 s si se usa transformer/LLM.
- [ ] Timeout duro de 2 s para inferencia; si falla, fallback a reglas con `degraded = true`.
- [ ] Procesar al menos 100 mensajes/s en local con modelo lineal.
- [ ] Contenido máximo a analizar: 2000 caracteres.
- [ ] Reintentos 3 veces con backoff; luego `moderation.failed` + DLQ.
- [ ] Retención de decisiones: 90 días configurable.
- [ ] El modelo no debe cargarse por request: cargar una vez al arrancar.

## 8. Consejo técnico y enfoque ML

**Stack recomendado:** Python 3.13 + FastAPI + `aio-pika` + SQLAlchemy 2 + PostgreSQL + `scikit-learn` + `joblib`/ONNX Runtime + `regex` + `structlog`.

Python es la elección natural porque el equipo quiere un modelo ML y ya hay dos servicios Python (`auth`, `network`). El quinto lenguaje se cubre con Elixir en `socket-gateway`, no aquí.

### Modelo recomendado para el prototipo

**Fase 1 (rápida y suficiente):** TF-IDF de palabras y caracteres + Regresión Logística (o LinearSVC) con `class_weight="balanced"`.

- Ventajas: entrena en segundos, no necesita GPU, el artefacto pesa pocos MB, inferencia < 10 ms.
- Salida: probabilidades por clase; se elige la clase con mayor probabilidad y se compara contra umbrales.
- Es explicable: se pueden listar los términos que más contribuyeron.

**Fase 2 (si hay tiempo):** modelo transformer multilingüe pequeño (DistilBERT/mDeBERTa) fine-tuneado, exportado a ONNX. Mejora el contexto y el sarcasmo, pero requiere más datos, tiempo y recursos.

**No empezar con un LLM:** es más caro, más lento y más difícil de evaluar. Si se usa, que sea un complemento con timeout y fallback.

### Datos y etiquetado

- [ ] Crear un dataset etiquetado con las 3 clases (`ALLOW`, `WARN`, `BLOCK`). Mínimo recomendado: 1,000–3,000 mensajes.
- [ ] Incluir ejemplos en español colombiano, jerga, leetspeak, enlaces, mayúsculas y mensajes benignos difíciles.
- [ ] Anonimizar: sin nombres, correos, teléfonos ni ubicaciones exactas.
- [ ] Separar train/validation/test (70/15/15) y no filtrar datos de test al entrenamiento.
- [ ] Guardar el dataset y las instrucciones de etiquetado en `ml/` (fuera del contenedor de producción).

### Entrenamiento y artefactos

- [ ] Script `ml/train.py` que lea el dataset, entrene, evalúe y guarde `models/moderation-<version>.joblib`.
- [ ] Guardar métricas: accuracy, macro F1, precision/recall por clase y matriz de confusión.
- [ ] Priorizar **recall de `BLOCK`** (no dejar pasar contenido grave) sin destruir la precisión de `ALLOW`.
- [ ] Versionar el modelo (`modelVersion`) y el vocabulario; incluir el artefacto en la imagen o montarlo desde un volumen.
- [ ] Test de inferencia con casos conocidos y de regresión.

### Serving

- [ ] Cargar el modelo al iniciar el servicio (`lifespan` de FastAPI).
- [ ] Exponer una función interna `predict(text) -> {decision, confidence, probabilities}`.
- [ ] Si el modelo no carga, arrancar en modo `degraded` con reglas y reportarlo en `/health`.
- [ ] No cargar el modelo en cada request.
- [ ] Considerar ONNX Runtime si el modelo es transformer; para TF-IDF + linear, `joblib` es suficiente.

### Métricas y evaluación

- [ ] Reportar macro F1 y recall de `BLOCK` en el README.
- [ ] Ajustar umbrales con el conjunto de validación, no con test.
- [ ] Analizar falsos positivos (mensajes benignos bloqueados) y falsos negativos (contenido grave permitido).
- [ ] Registrar en la decisión `modelVersion`, `confidence` y `degraded`.

**Alternativa de lenguaje:** C#/.NET 9 + ML.NET. Serviría para el quinto lenguaje, pero el ecosistema de NLP y la iteración son peores que Python. No es recomendable si el equipo no tiene experiencia.

**Trampas**

- No usar `contains` simple para términos: falsos positivos.
- No mandar email/username al modelo; solo contenido.
- No hacer inferencia dentro del handler HTTP del mensaje: el flujo es por cola.
- No dejar mensajes en `PENDING` para siempre si moderation falla.
- No hardcodear listas de insultos en el repo.
- No entrenar con datos reales sin anonimizar.

## 9. Tareas

- [ ] Crear `services/moderation` con capas `handler`, `service`, `rules`, `ml`, `repository`, `consumer`.
- [ ] Migración de `moderation_decisions`.
- [ ] Dataset etiquetado y script `ml/train.py`.
- [ ] Entrenar el modelo baseline y guardar artefacto + métricas.
- [ ] Implementar normalización, reglas duras y combinación híbrida.
- [ ] Implementar escalamiento por historial.
- [ ] Consumidor idempotente y publicación de decisiones.
- [ ] `moderation.failed` y política de reintentos/DLQ.
- [ ] Tests de reglas, ML, idempotencia y fallback.
- [ ] `README.md`, `.env.example`, `Dockerfile`, `docker-compose.yml`.
- [ ] Definir con `messages` la política `FAIL_OPEN`/`FAIL_CLOSED`.

## 10. Definition of Done

- [ ] Un mensaje limpio se publica y aparece en `nearby`.
- [ ] Un mensaje con contenido grave se bloquea y no aparece.
- [ ] Un mensaje con advertencia se publica con la marca.
- [ ] El modelo devuelve decisión + confianza y se guarda `modelVersion`.
- [ ] Si el modelo no carga, el servicio sigue con reglas y `degraded = true`.
- [ ] Reenviar el mismo evento no duplica decisiones.
- [ ] La DLQ recibe fallos definitivos y se pueden republicar.
