#!/usr/bin/env bash
# ==============================================================================
# GeoPicto — Runner de escenarios por flujo (Persona 7)
# ==============================================================================
# Un comando que:
#   1. Detecta el destino (https://localhost del Reverse Proxy de P3, o
#      http://localhost:8080 del Gateway de P2).
#   2. Siembra datos con seed-data.mjs (omitible con --skip-seed).
#   3. Ejecuta cada escenario de performance/scenarios/ con k6 (local o, si no
#      está instalado, con la imagen oficial grafana/k6 en Docker).
#   4. Guarda por flujo: summary.json, metrics.csv.gz, report.html, console.txt
#      y consolida todo en summary.csv / summary.md / summary.json.
#
# La batería Load/Stress/Spike con métricas de CPU/RAM es de la Persona 8
# (run-performance-suite.sh); este runner sirve para perfilar cada flujo por
# separado y para validar los scripts. Ver performance/README.md.
#
# Ejemplos:
#   ./performance/run-scenarios.sh
#   ./performance/run-scenarios.sh --label p3-base --mode single --vus 100 --duration 1m
#   ./performance/run-scenarios.sh --flows "nearby graphql" --mode rate --rate 200
#   ./performance/run-scenarios.sh --smoke          # 5 VUs x 20 s por flujo
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_ROOT="${SCRIPT_DIR}/results"

RUN_LABEL="${RUN_LABEL:-}"
BASE_URL="${BASE_URL:-}"
FLOWS="${FLOWS:-nearby write auth graphql mixed}"
MODE="${MODE:-stages}"
VUS="${VUS:-50}"
DURATION="${DURATION:-1m}"
RATE="${RATE:-50}"
STAGES="${STAGES:-}"
THINK_TIME="${THINK_TIME:-1.0}"
REQ_TIMEOUT="${REQ_TIMEOUT:-5s}"
ASYNC_PROBE_RATE="${ASYNC_PROBE_RATE:-0.03}"
HTML_REPORT="${HTML_REPORT:-1}"
K6_IMAGE="${K6_IMAGE:-grafana/k6:0.54.0}"
COOLDOWN_SECONDS="${COOLDOWN_SECONDS:-5}"
SKIP_SEED=0
SUMMARY_TREND_STATS="avg,min,med,max,p(90),p(95),p(99)"

usage() {
  cat <<'EOF'
Uso: run-scenarios.sh [opciones]

  --label <nombre>     Carpeta de salida: results/p7-<nombre> (por defecto: fecha)
  --base-url <url>     Destino (auto: https://localhost y luego http://localhost:8080)
  --flows "<lista>"    Escenarios: nearby write auth graphql mixed (por defecto todos)
  --mode <modo>        stages | single | rate (por defecto: stages)
  --vus <n>            VUs constantes en modo single (50)
  --duration <d>       Duración en modo single/rate (1m)
  --rate <n>           Iteraciones/s en modo rate (50)
  --stages "<spec>"    Rampa para modo stages, p. ej. "30s:25,1m:100,30s:0"
  --smoke              Prueba de humo: modo single, 5 VUs, 20 s por flujo
  --skip-seed          No ejecutar seed-data.mjs (reutiliza .seed-manifest.json)
  --no-html            No generar el reporte HTML de k6
  -h, --help           Esta ayuda

Variables extra: THINK_TIME REQ_TIMEOUT ASYNC_PROBE_RATE K6_IMAGE COOLDOWN_SECONDS
y cualquier variable de los escenarios (NEARBY_RADII, MIX, AUTH_FAIL_RATIO...),
que se reenvía a k6 si se exporta con prefijo P7_ (p. ej. P7_MIX="nearby:80,auth:20").
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) RUN_LABEL="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --flows) FLOWS="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --vus) VUS="$2"; shift 2 ;;
    --duration) DURATION="$2"; shift 2 ;;
    --rate) RATE="$2"; shift 2 ;;
    --stages) STAGES="$2"; shift 2 ;;
    --smoke) MODE="single"; VUS=5; DURATION="20s"; COOLDOWN_SECONDS=1; shift ;;
    --skip-seed) SKIP_SEED=1; shift ;;
    --no-html) HTML_REPORT=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; usage >&2; exit 1 ;;
  esac
done

case "${MODE}" in single|stages|rate) ;; *) echo "ERROR: --mode debe ser single, stages o rate." >&2; exit 1 ;; esac
for flow in ${FLOWS}; do
  [[ -f "${SCRIPT_DIR}/scenarios/${flow}.js" ]] || { echo "ERROR: no existe scenarios/${flow}.js" >&2; exit 1; }
done

# ------------------------------------------------------------------------------
# k6: binario local o contenedor Docker
# ------------------------------------------------------------------------------
K6_RUNNER="local"
if ! command -v k6 >/dev/null 2>&1; then
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    K6_RUNNER="docker"
  else
    echo "ERROR: k6 no está instalado y Docker no está disponible." >&2
    echo "Instala k6 (https://grafana.com/docs/k6/latest/set-up/install-k6/) o arranca Docker." >&2
    exit 1
  fi
fi

# Ruta del host montable en Docker (Git Bash en Windows necesita la ruta C:/...)
HOST_PERF_DIR="$(cd "${SCRIPT_DIR}" && (pwd -W 2>/dev/null || pwd))"

# Convierte una ruta local dentro de performance/ a la que ve k6
k6_path() {
  local p="$1"
  if [[ "${K6_RUNNER}" == "docker" ]]; then
    echo "/perf/${p#"${SCRIPT_DIR}/"}"
  else
    echo "${p}"
  fi
}

run_k6() {
  if [[ "${K6_RUNNER}" == "docker" ]]; then
    local env_args=()
    for kv in "${K6_ENV_VARS[@]}"; do env_args+=(-e "${kv}"); done
    MSYS_NO_PATHCONV=1 docker run --rm -i \
      --add-host=host.docker.internal:host-gateway \
      -u "$(id -u 2>/dev/null || echo 0):$(id -g 2>/dev/null || echo 0)" \
      -v "${HOST_PERF_DIR}:/perf" -w /perf \
      "${env_args[@]}" \
      "${K6_IMAGE}" "$@"
  else
    env "${K6_ENV_VARS[@]}" k6 "$@"
  fi
}

# ------------------------------------------------------------------------------
# Destino
# ------------------------------------------------------------------------------
probe_endpoint() {
  local code
  code="$(curl -ksS --max-time 5 -o /dev/null -w "%{http_code}" "$1/api/messages/nearby?lat=4.6371&lng=-74.0834&radius=100" 2>/dev/null || echo "000")"
  [[ "${code}" == "200" || "${code}" == "429" ]]
}

if [[ -z "${BASE_URL}" ]]; then
  if probe_endpoint "https://localhost"; then
    BASE_URL="https://localhost"
  elif probe_endpoint "http://localhost:8080"; then
    BASE_URL="http://localhost:8080"
  else
    echo "ERROR: GeoPicto no responde en https://localhost ni en http://localhost:8080." >&2
    echo "Levanta el stack ('docker compose up --build -d --wait') o pasa --base-url." >&2
    exit 1
  fi
fi
BASE_URL="${BASE_URL%/}"

# Desde el contenedor de k6, "localhost" es el propio contenedor
K6_BASE_URL="${BASE_URL}"
if [[ "${K6_RUNNER}" == "docker" ]]; then
  K6_BASE_URL="$(echo "${BASE_URL}" | sed -E 's#://(localhost|127\.0\.0\.1)#://host.docker.internal#')"
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${RESULTS_ROOT}/p7-${RUN_LABEL:-${TIMESTAMP}}"
mkdir -p "${RUN_DIR}"

echo "========================================================================"
echo " GeoPicto — Escenarios por flujo (Persona 7)"
echo "------------------------------------------------------------------------"
echo " Destino        : ${BASE_URL}  (k6 ve: ${K6_BASE_URL})"
echo " k6             : ${K6_RUNNER}$([[ "${K6_RUNNER}" == "docker" ]] && echo " (${K6_IMAGE})")"
echo " Flujos         : ${FLOWS}"
case "${MODE}" in
  single) echo " Modo           : single — ${VUS} VUs x ${DURATION}" ;;
  rate)   echo " Modo           : rate — ${RATE} it/s x ${DURATION}" ;;
  stages) echo " Modo           : stages — ${STAGES:-rampa por defecto 25 -> 50 -> 100 VUs}" ;;
esac
echo " Salida         : ${RUN_DIR}"
echo "========================================================================"

# ------------------------------------------------------------------------------
# 1. Seeding
# ------------------------------------------------------------------------------
MANIFEST="${SCRIPT_DIR}/.seed-manifest.json"
if [[ "${SKIP_SEED}" -eq 0 ]]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: se necesita Node.js >= 18 para seed-data.mjs (o usa --skip-seed con un manifest existente)." >&2
    exit 1
  fi
  echo "[1/3] Sembrando datos (seed-data.mjs)..."
  BASE_URL="${BASE_URL}" node "${SCRIPT_DIR}/seed-data.mjs"
else
  echo "[1/3] Seeding omitido (--skip-seed)."
fi
if [[ ! -f "${MANIFEST}" ]]; then
  echo "ERROR: no existe ${MANIFEST}. Ejecuta sin --skip-seed." >&2
  exit 1
fi

# ------------------------------------------------------------------------------
# 2. Escenarios
# ------------------------------------------------------------------------------
echo "[2/3] Ejecutando escenarios..."
FAILED_FLOWS=()

for FLOW_NAME in ${FLOWS}; do
  OUT_DIR="${RUN_DIR}/${FLOW_NAME}"
  mkdir -p "${OUT_DIR}"

  K6_ENV_VARS=(
    "BASE_URL=${K6_BASE_URL}"
    "MODE=${MODE}"
    "VUS=${VUS}"
    "DURATION=${DURATION}"
    "RATE=${RATE}"
    "THINK_TIME=${THINK_TIME}"
    "REQ_TIMEOUT=${REQ_TIMEOUT}"
    "SEED_MANIFEST=$(k6_path "${MANIFEST}")"
    "TEST_ID=$(basename "${RUN_DIR}")-${FLOW_NAME}"
    "K6_NO_USAGE_REPORT=true"
  )
  [[ -n "${STAGES}" ]] && K6_ENV_VARS+=("STAGES=${STAGES}")
  [[ "${FLOW_NAME}" == "write" ]] && K6_ENV_VARS+=("ASYNC_PROBE_RATE=${ASYNC_PROBE_RATE}")
  # Reenviar variables P7_* sin el prefijo (P7_MIX -> MIX)
  while IFS='=' read -r name value; do
    [[ "${name}" == P7_* ]] && K6_ENV_VARS+=("${name#P7_}=${value}")
  done < <(env)
  if [[ "${HTML_REPORT}" -eq 1 ]]; then
    K6_ENV_VARS+=(
      "K6_WEB_DASHBOARD=true"
      "K6_WEB_DASHBOARD_OPEN=false"
      "K6_WEB_DASHBOARD_EXPORT=$(k6_path "${OUT_DIR}/report.html")"
    )
  fi

  cat > "${OUT_DIR}/run_meta.json" <<EOF
{
  "flow": "${FLOW_NAME}",
  "mode": "${MODE}",
  "vus": ${VUS},
  "rate": ${RATE},
  "duration": "${DURATION}",
  "stages": "${STAGES}",
  "think_time": "${THINK_TIME}",
  "base_url": "${BASE_URL}",
  "k6_runner": "${K6_RUNNER}",
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

  echo ""
  echo ">>> ${FLOW_NAME}"
  set +e
  run_k6 run \
    --insecure-skip-tls-verify \
    --summary-trend-stats="${SUMMARY_TREND_STATS}" \
    --summary-export="$(k6_path "${OUT_DIR}/summary.json")" \
    --out "csv=$(k6_path "${OUT_DIR}/metrics.csv.gz")" \
    "$(k6_path "${SCRIPT_DIR}/scenarios/${FLOW_NAME}.js")" \
    2>&1 | tee "${OUT_DIR}/console.txt"
  K6_EXIT=${PIPESTATUS[0]}
  set -e

  # 99 = umbrales no cumplidos (resultado válido); otro código = la prueba falló
  if [[ "${K6_EXIT}" -eq 99 ]]; then
    echo "  -> ${FLOW_NAME}: terminó con umbrales NO cumplidos (ver summary)."
  elif [[ "${K6_EXIT}" -ne 0 ]]; then
    echo "  -> ${FLOW_NAME}: k6 falló (código ${K6_EXIT}). Ver ${OUT_DIR}/console.txt" >&2
    FAILED_FLOWS+=("${FLOW_NAME}")
  fi
  sleep "${COOLDOWN_SECONDS}"
done

# ------------------------------------------------------------------------------
# 3. Consolidación
# ------------------------------------------------------------------------------
echo ""
echo "[3/3] Consolidando resultados..."
if command -v node >/dev/null 2>&1; then
  node "${SCRIPT_DIR}/tools/summarize-results.mjs" "${RUN_DIR}"
else
  echo "  (Node.js no disponible: se omite summary.csv/md; los summary.json por flujo están listos)"
fi

echo ""
echo "========================================================================"
echo " Listo: ${RUN_DIR}"
echo "   summary.md / summary.csv / summary.json  — tabla consolidada"
echo "   <flujo>/report.html                      — reporte HTML de k6"
echo "   <flujo>/summary.json, metrics.csv.gz      — datos crudos"
if [[ ${#FAILED_FLOWS[@]} -gt 0 ]]; then
  echo " Flujos con error de ejecución: ${FAILED_FLOWS[*]}"
  echo "========================================================================"
  exit 1
fi
echo "========================================================================"
