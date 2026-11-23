#!/usr/bin/env node
/**
 * GeoPicto — Consolidador de resultados de escenarios (Persona 7)
 *
 * Lee <runDir>/<flujo>/summary.json (formato --summary-export de k6) y
 * run_meta.json, y escribe en <runDir>:
 *   summary.csv   una fila por flujo (para hojas de cálculo / Persona 8)
 *   summary.md    tabla lista para pegar en el documento
 *   summary.json  lo mismo, estructurado
 *
 * Uso: node performance/tools/summarize-results.mjs performance/results/p7-<label>
 */

import fs from 'node:fs';
import path from 'node:path';

const runDir = process.argv[2];
if (!runDir || !fs.existsSync(runDir)) {
  console.error('Uso: node tools/summarize-results.mjs <carpeta de resultados p7-*>');
  process.exit(2);
}

// Métrica de latencia principal de cada flujo (mismos nombres que Persona 8)
const FLOW_METRIC = {
  nearby: 'flow_nearby_duration',
  write: 'flow_write_duration',
  auth: 'flow_auth_duration',
  graphql: 'flow_graphql_duration',
  mixed: 'http_req_duration',
};
const FLOW_COUNTER = {
  nearby: 'flow_nearby_reqs',
  write: 'flow_write_reqs',
  auth: 'flow_auth_reqs',
  graphql: 'flow_graphql_reqs',
};

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
};
const round = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const pct = (v) => (typeof v === 'number' ? round(v * 100, 2) : null);

function rateValue(metric) {
  if (!metric) return null;
  if (typeof metric.value === 'number') return metric.value;
  if (typeof metric.rate === 'number') return metric.rate;
  const passes = metric.passes ?? 0;
  const fails = metric.fails ?? 0;
  return passes + fails > 0 ? passes / (passes + fails) : null;
}

function summarizeFlow(flow, summary, meta) {
  const m = summary.metrics || {};
  const lat = m[FLOW_METRIC[flow]] || m.http_req_duration || {};
  const flowReqs = m[FLOW_COUNTER[flow]];
  const httpReqs = m.http_reqs || {};
  const durationS = summary.state?.testRunDurationMs ? summary.state.testRunDurationMs / 1000 : null;

  const row = {
    flow,
    mode: meta?.mode ?? null,
    load:
      meta?.mode === 'single'
        ? `${meta.vus} VUs`
        : meta?.mode === 'rate'
          ? `${meta.rate} it/s`
          : meta?.stages || 'rampa 25→50→100',
    vus_max: m.vus_max?.max ?? m.vus_max?.value ?? null,
    duration_s: round(durationS, 1),
    requests: flowReqs?.count ?? httpReqs.count ?? null,
    rps: round(flowReqs?.rate ?? httpReqs.rate),
    avg_ms: round(lat.avg),
    p50_ms: round(lat.med),
    p90_ms: round(lat['p(90)']),
    p95_ms: round(lat['p(95)']),
    p99_ms: round(lat['p(99)']),
    max_ms: round(lat.max),
    http_failed_pct: pct(rateValue(m.http_req_failed)),
    real_error_pct: pct(rateValue(m.real_error_rate)),
    rate_limited_pct: pct(rateValue(m.rate_limited_rate)),
    unexpected_status_pct: pct(rateValue(m.unexpected_status_rate)),
    checks_pass_pct: pct(rateValue(m.checks)),
    token_refreshes: m.token_refreshes?.count ?? 0,
  };

  // Extras por flujo
  if (m.nearby_results_count) {
    row.nearby_results_avg = round(m.nearby_results_count.avg, 1);
    row.nearby_results_p95 = round(m.nearby_results_count['p(95)'], 1);
    row.nearby_payload_kb_avg = round((m.nearby_payload_bytes?.avg ?? 0) / 1024, 1);
  }
  if (m.write_post_message_duration) row.post_message_p95_ms = round(m.write_post_message_duration['p(95)']);
  if (m.write_put_rating_duration) row.put_rating_p95_ms = round(m.write_put_rating_duration['p(95)']);
  if (m.message_publish_latency) {
    row.publish_latency_p50_ms = round(m.message_publish_latency.med);
    row.publish_latency_p95_ms = round(m.message_publish_latency['p(95)']);
  }
  if (m.message_publish_timeouts) row.publish_timeouts = m.message_publish_timeouts.count;
  if (m.auth_login_ok_duration) row.login_ok_p95_ms = round(m.auth_login_ok_duration['p(95)']);
  if (m.auth_login_rejected_duration) row.login_rejected_p95_ms = round(m.auth_login_rejected_duration['p(95)']);
  if (m.graphql_error_rate) row.graphql_error_pct = pct(rateValue(m.graphql_error_rate));
  if (flow === 'mixed') {
    for (const [name, metric] of Object.entries(FLOW_METRIC)) {
      if (name !== 'mixed' && m[metric]) row[`${name}_p95_ms`] = round(m[metric]['p(95)']);
    }
  }
  return row;
}

const flows = fs
  .readdirSync(runDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(runDir, d.name, 'summary.json')))
  .map((d) => d.name)
  .sort((a, b) => Object.keys(FLOW_METRIC).indexOf(a) - Object.keys(FLOW_METRIC).indexOf(b));

if (flows.length === 0) {
  console.error(`No hay <flujo>/summary.json en ${runDir}`);
  process.exit(1);
}

const rows = flows.map((flow) =>
  summarizeFlow(flow, readJson(path.join(runDir, flow, 'summary.json')), readJson(path.join(runDir, flow, 'run_meta.json')))
);

// CSV con la unión de columnas
const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
const csvCell = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
fs.writeFileSync(
  path.join(runDir, 'summary.csv'),
  [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'
);

fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({ runDir: path.basename(runDir), rows }, null, 2));

// Markdown
const FLOW_TITLE = {
  nearby: 'Flujo 1 — Nearby (PostGIS)',
  write: 'Flujo 2 — Escritura + RabbitMQ',
  auth: 'Flujo 3 — Login (Argon2id)',
  graphql: 'Flujo 4 — GraphQL + MongoDB',
  mixed: 'Mixto (50/20/20/10)',
};
const show = (v, suffix = '') => (v === null || v === undefined ? '—' : `${v}${suffix}`);
const md = [];
md.push(`# Resultados por flujo — ${path.basename(runDir)}`, '');
md.push(`Destino: \`${readJson(path.join(runDir, flows[0], 'run_meta.json'))?.base_url ?? '?'}\``, '');
md.push('| Flujo | Carga | Req | RPS | p50 | p90 | p95 | p99 | Error real | 429 | Checks |');
md.push('| :-- | :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: |');
for (const r of rows) {
  md.push(
    `| ${FLOW_TITLE[r.flow] || r.flow} | ${r.load} | ${show(r.requests)} | ${show(r.rps)} | ` +
      `${show(r.p50_ms, ' ms')} | ${show(r.p90_ms, ' ms')} | ${show(r.p95_ms, ' ms')} | ${show(r.p99_ms, ' ms')} | ` +
      `${show(r.real_error_pct, ' %')} | ${show(r.rate_limited_pct, ' %')} | ${show(r.checks_pass_pct, ' %')} |`
  );
}
md.push('', '## Métricas específicas', '');
for (const r of rows) {
  const extras = [];
  if (r.nearby_results_avg !== undefined)
    extras.push(`resultados por consulta: media ${r.nearby_results_avg}, p95 ${r.nearby_results_p95}; payload medio ${r.nearby_payload_kb_avg} KB`);
  if (r.post_message_p95_ms !== undefined) extras.push(`POST /messages p95 ${r.post_message_p95_ms} ms`);
  if (r.put_rating_p95_ms !== undefined) extras.push(`PUT /ratings p95 ${r.put_rating_p95_ms} ms`);
  if (r.publish_latency_p95_ms !== undefined)
    extras.push(`publicación asíncrona (moderación vía RabbitMQ): p50 ${r.publish_latency_p50_ms} ms, p95 ${r.publish_latency_p95_ms} ms`);
  if (r.publish_timeouts) extras.push(`${r.publish_timeouts} mensajes sin publicar dentro del timeout`);
  if (r.login_ok_p95_ms !== undefined) extras.push(`login correcto p95 ${r.login_ok_p95_ms} ms`);
  if (r.login_rejected_p95_ms !== undefined) extras.push(`login rechazado p95 ${r.login_rejected_p95_ms} ms`);
  if (r.graphql_error_pct !== undefined) extras.push(`errores GraphQL ${r.graphql_error_pct} %`);
  for (const k of ['nearby', 'write', 'auth', 'graphql']) {
    if (r[`${k}_p95_ms`] !== undefined) extras.push(`${k} p95 ${r[`${k}_p95_ms`]} ms`);
  }
  if (r.token_refreshes) extras.push(`${r.token_refreshes} sesiones renovadas durante la prueba`);
  if (extras.length) md.push(`- **${FLOW_TITLE[r.flow] || r.flow}:** ${extras.join('; ')}.`);
}
md.push(
  '',
  '_Error real_ = timeouts, 408 y 5xx. Los 429 (rate limiting) se reportan aparte porque son una defensa, no saturación.',
  ''
);
fs.writeFileSync(path.join(runDir, 'summary.md'), md.join('\n'));

console.log(md.slice(0, 4 + rows.length + 1).join('\n'));
console.log(`\nEscrito: ${['summary.csv', 'summary.md', 'summary.json'].map((f) => path.join(runDir, f)).join(', ')}`);
