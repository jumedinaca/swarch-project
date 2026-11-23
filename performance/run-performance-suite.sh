#!/usr/bin/env bash
# ==============================================================================
# GeoPicto — End-to-End Performance Testing Suite Orchestrator (Persona 8)
# ==============================================================================
# One-command runner that:
#   1. Auto-detects target URL (HTTPS :443 Reverse Proxy vs HTTP :8080 Gateway)
#      and security runtime configuration (TLS, Rate Limiting, active containers).
#   2. Seeds realistic users, geolocated messages, and friendships.
#   3. Executes Load, Stress (up to 2000 VUs), Spike (up to 1000+ VUs), and
#      optional Protected Rate-Limit profiles with k6.
#   4. Records synchronized Docker container CPU/RAM/Net/Block telemetry.
#   5. Invokes analyze_results.py to produce English CSV tables, PNG charts,
#      and a ready-to-paste p3_performance_section.md report draft.
#
# Examples:
#   ./performance/run-performance-suite.sh --label p3-hardened
#   ./performance/run-performance-suite.sh --label p2-baseline
#   STRESS_LEVELS="25 100 250 500 1000 2000" SPIKE_VUS=1500 \
#     ./performance/run-performance-suite.sh --label p3-hardened
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_ROOT="${SCRIPT_DIR}/results"

# Defaults (all overridable via CLI flags or env vars)
RUN_LABEL="${RUN_LABEL:-}"
BASE_URL="${BASE_URL:-}"
PROFILES="${PROFILES:-load stress spike}"
FLOW="${FLOW:-mixed}"
PROJECT="${PROJECT:-geopicto}"
RATE_LIMIT_MODE="${RATE_LIMIT_MODE:-auto}"
SKIP_SEED=0
SKIP_ANALYSIS=0
KEEP_RAW_NDJSON="${KEEP_RAW_NDJSON:-0}"

LOAD_LEVELS="${LOAD_LEVELS:-25 50 100}"
STRESS_LEVELS="${STRESS_LEVELS:-25 100 250 500 1000 2000}"
LOAD_DURATION="${LOAD_DURATION:-30s}"
STRESS_DURATION="${STRESS_DURATION:-30s}"

SPIKE_BASE_VUS="${SPIKE_BASE_VUS:-25}"
SPIKE_VUS="${SPIKE_VUS:-1000}"
SPIKE_BASE_DURATION="${SPIKE_BASE_DURATION:-20s}"
SPIKE_DURATION="${SPIKE_DURATION:-25s}"
SPIKE_RECOVERY_DURATION="${SPIKE_RECOVERY_DURATION:-40s}"

RATELIMIT_VUS="${RATELIMIT_VUS:-100}"
RATELIMIT_DURATION="${RATELIMIT_DURATION:-30s}"

REQ_TIMEOUT="${REQ_TIMEOUT:-5s}"
THINK_TIME="${THINK_TIME:-1.0}"
SAMPLE_INTERVAL="${SAMPLE_INTERVAL:-2}"
COOLDOWN_SECONDS="${COOLDOWN_SECONDS:-5}"
SUMMARY_TREND_STATS="avg,min,med,max,p(90),p(95),p(99)"

# Optional hook: run Persona 7's custom k6 script instead of profiles/{load,stress}.js
CUSTOM_K6_SCRIPT="${CUSTOM_K6_SCRIPT:-}"

usage() {
  cat <<'EOF'
Usage: run-performance-suite.sh [options]

Options:
  --label <name>         Output folder label (e.g., p3-hardened, p2-baseline)
  --base-url <url>       Target URL (auto-detects https://localhost then http://localhost:8080)
  --profiles "<list>"    Space-separated profiles: load stress spike ratelimit (default: "load stress spike")
  --flow <name>          Workload flow: mixed | nearby | write | auth | graphql (default: mixed)
  --rate-limit <mode>    Rate limit state: auto | enabled | disabled (default: auto)
  --project <name>       Docker Compose project name (default: geopicto)
  --skip-seed            Reuse existing performance/.seed-manifest.json
  --skip-analysis        Skip running analyze_results.py at the end
  -h, --help             Show this help message

Key Environment Overrides:
  LOAD_LEVELS="25 50 100"
  STRESS_LEVELS="25 100 250 500 1000 2000"
  LOAD_DURATION="30s"  STRESS_DURATION="30s"
  SPIKE_BASE_VUS=25  SPIKE_VUS=1000  SPIKE_DURATION="25s"  SPIKE_RECOVERY_DURATION="40s"
  REQ_TIMEOUT="5s"  THINK_TIME="1.0"  SAMPLE_INTERVAL=2  COOLDOWN_SECONDS=5
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) RUN_LABEL="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --profiles) PROFILES="$2"; shift 2 ;;
    --flow) FLOW="$2"; shift 2 ;;
    --rate-limit) RATE_LIMIT_MODE="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --skip-seed) SKIP_SEED=1; shift ;;
    --skip-analysis) SKIP_ANALYSIS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

# Verify prerequisites
for bin in k6 curl node python3 docker; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "ERROR: Required tool '${bin}' is not installed or not in PATH." >&2
    exit 1
  fi
done

# Raise file descriptor limit for 2000+ concurrent VUs on macOS / Linux
ulimit -n 65536 2>/dev/null || ulimit -n 10240 2>/dev/null || true

# Auto-detect BASE_URL (P3 HTTPS Reverse Proxy on :443 first, then P2 HTTP Gateway on :8080)
probe_endpoint() {
  local url="$1"
  local code
  code="$(curl -ksS --max-time 5 -o /dev/null -w "%{http_code}" "${url}/api/messages/nearby?lat=4.6371&lng=-74.0834&radius=500" 2>/dev/null || echo "000")"
  [[ "${code}" == "200" || "${code}" == "429" ]]
}

if [[ -z "${BASE_URL}" ]]; then
  if probe_endpoint "https://localhost"; then
    BASE_URL="https://localhost"
  elif probe_endpoint "http://localhost:8080"; then
    BASE_URL="http://localhost:8080"
  else
    echo "ERROR: Could not reach GeoPicto on https://localhost or http://localhost:8080." >&2
    echo "Make sure the stack is up ('docker compose up -d --wait') or pass --base-url <url>." >&2
    exit 1
  fi
fi
BASE_URL="${BASE_URL%/}"

# Auto-detect RATE_LIMIT_ENABLED from running gateway container if requested
if [[ "${RATE_LIMIT_MODE}" == "auto" ]]; then
  GW_CONTAINER="$(docker ps --filter "label=com.docker.compose.project=${PROJECT}" --format '{{.Names}}' | grep -E '(^|-)gateway(-|$)' | head -n 1 || true)"
  if [[ -n "${GW_CONTAINER}" ]]; then
    RL_ENV="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${GW_CONTAINER}" 2>/dev/null | grep '^RATE_LIMIT_ENABLED=' | head -n 1 | cut -d= -f2- || true)"
    if [[ "${RL_ENV}" == "false" || "${RL_ENV}" == "0" ]]; then
      RATE_LIMIT_MODE="disabled"
    elif [[ "${RL_ENV}" == "true" || "${RL_ENV}" == "1" ]]; then
      RATE_LIMIT_MODE="enabled"
    else
      # If gateway has Redis rate-limit vars defined, assume enabled; else P2 baseline (not present)
      if docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${GW_CONTAINER}" 2>/dev/null | grep -q 'RATE_LIMIT_'; then
        RATE_LIMIT_MODE="enabled"
      else
        RATE_LIMIT_MODE="not_configured"
      fi
    fi
  else
    RATE_LIMIT_MODE="unknown"
  fi
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
if [[ -z "${RUN_LABEL}" ]]; then
  RUN_ID="${TIMESTAMP}"
  RUN_LABEL="${TIMESTAMP}"
else
  RUN_ID="${RUN_LABEL}"
fi

RUN_DIR="${RESULTS_ROOT}/${RUN_ID}"
mkdir -p "${RUN_DIR}"
PHASE_FILE="${RUN_DIR}/.current_phase"

COLLECTOR_PID=""
cleanup() {
  if [[ -n "${COLLECTOR_PID}" ]] && kill -0 "${COLLECTOR_PID}" 2>/dev/null; then
    kill "${COLLECTOR_PID}" 2>/dev/null || true
    wait "${COLLECTOR_PID}" 2>/dev/null || true
  fi
  rm -f "${PHASE_FILE}"
}
trap cleanup INT TERM EXIT

start_collector() {
  local csv_path="$1"
  local initial_phase="$2"
  echo "${initial_phase}" > "${PHASE_FILE}"
  "${SCRIPT_DIR}/collect-metrics.sh" \
    --output "${csv_path}" \
    --interval "${SAMPLE_INTERVAL}" \
    --phase-file "${PHASE_FILE}" \
    --project "${PROJECT}" &
  COLLECTOR_PID=$!
}

stop_collector() {
  if [[ -n "${COLLECTOR_PID}" ]] && kill -0 "${COLLECTOR_PID}" 2>/dev/null; then
    kill "${COLLECTOR_PID}" 2>/dev/null || true
    wait "${COLLECTOR_PID}" 2>/dev/null || true
  fi
  COLLECTOR_PID=""
}

compact_spike_ndjson() {
  local ndjson_path="$1"
  local csv_out="$2"
  local bucket_sec="${3:-2}"

  python3 - "${ndjson_path}" "${csv_out}" "${bucket_sec}" <<'PY'
import csv
import json
import sys
from collections import defaultdict
from datetime import datetime
import numpy as np

ndjson_path, csv_out, bucket_sec_str = sys.argv[1:4]
bucket_sec = max(1, int(bucket_sec_str))

def parse_ts(raw: str) -> float:
    # Handle RFC3339 timestamps with optional nanoseconds & Z or +/-HH:MM
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    if "." in raw:
        head, tail = raw.split(".", 1)
        # Split fractional seconds from timezone offset
        tz_idx = max(tail.find("+"), tail.find("-"))
        if tz_idx != -1:
            frac = tail[:tz_idx][:6].ljust(6, "0")
            tz = tail[tz_idx:]
            raw = f"{head}.{frac}{tz}"
        else:
            raw = f"{head}.{tail[:6].ljust(6, '0')}"
    return datetime.fromisoformat(raw).timestamp()

buckets = defaultdict(lambda: {"durations": [], "vus": [], "total": 0, "err": 0, "r429": 0})
t0 = None

with open(ndjson_path, "r", encoding="utf-8") as fh:
    for line in fh:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("type") != "Point":
            continue
        metric = obj.get("metric")
        data = obj.get("data") or {}
        ts_raw = data.get("time")
        if not ts_raw:
            continue
        ts = parse_ts(ts_raw)
        if t0 is None or ts < t0:
            t0 = ts
        b_idx = int((ts - t0) // bucket_sec)
        val = float(data.get("value", 0.0))
        tags = data.get("tags") or {}

        if metric == "http_req_duration":
            buckets[b_idx]["durations"].append(val)
            buckets[b_idx]["total"] += 1
            status = str(tags.get("status", "0"))
            if status == "429":
                buckets[b_idx]["r429"] += 1
            elif status == "0" or status.startswith("5") or status.startswith("4"):
                buckets[b_idx]["err"] += 1
        elif metric == "vus":
            buckets[b_idx]["vus"].append(val)

if t0 is None:
    sys.exit(0)

with open(csv_out, "w", newline="", encoding="utf-8") as out:
    writer = csv.writer(out)
    writer.writerow([
        "elapsed_s", "epoch_s", "vus", "rps",
        "avg_ms", "p50_ms", "p95_ms", "p99_ms",
        "err_pct", "rate_429_pct", "total_reqs",
    ])
    for b_idx in sorted(buckets.keys()):
        b = buckets[b_idx]
        elapsed = b_idx * bucket_sec
        epoch = int(t0 + elapsed)
        vus_val = float(np.mean(b["vus"])) if b["vus"] else 0.0
        total = b["total"]
        rps = total / float(bucket_sec)
        if b["durations"]:
            arr = np.array(b["durations"], dtype=float)
            avg_ms = float(np.mean(arr))
            p50_ms = float(np.percentile(arr, 50))
            p95_ms = float(np.percentile(arr, 95))
            p99_ms = float(np.percentile(arr, 99))
        else:
            avg_ms = p50_ms = p95_ms = p99_ms = 0.0
        err_pct = (b["err"] / total * 100.0) if total > 0 else 0.0
        r429_pct = (b["r429"] / total * 100.0) if total > 0 else 0.0
        writer.writerow([
            elapsed, epoch, f"{vus_val:.1f}", f"{rps:.2f}",
            f"{avg_ms:.2f}", f"{p50_ms:.2f}", f"{p95_ms:.2f}", f"{p99_ms:.2f}",
            f"{err_pct:.2f}", f"{r429_pct:.2f}", total,
        ])
PY
}

echo "========================================================================"
echo " GeoPicto — Performance Testing Suite (Persona 8)"
echo "------------------------------------------------------------------------"
echo " Run Label       : ${RUN_LABEL}"
echo " Output Dir      : ${RUN_DIR}"
echo " Target BASE_URL : ${BASE_URL}"
echo " Rate Limiting   : ${RATE_LIMIT_MODE}"
echo " Workload Flow   : ${FLOW}"
echo " Profiles        : ${PROFILES}"
echo " Load Levels     : ${LOAD_LEVELS} (${LOAD_DURATION}/level)"
echo " Stress Levels   : ${STRESS_LEVELS} (${STRESS_DURATION}/level)"
echo " Spike Profile   : ${SPIKE_BASE_VUS} -> ${SPIKE_VUS} -> ${SPIKE_BASE_VUS} VUs"
echo "========================================================================"

# 1. Capture host & environment metadata
echo "[1/4] Capturing host, Docker, and security environment metadata..."
"${SCRIPT_DIR}/collect-metrics.sh" \
  --host-info "${RUN_DIR}/host_info.json" \
  --host-info-only \
  --project "${PROJECT}" \
  --base-url "${BASE_URL}" \
  --rate-limit "${RATE_LIMIT_MODE}" \
  --label "${RUN_LABEL}"

# 2. Seed realistic test data (prefers Persona 7's seed-data.mjs if present)
if [[ "${SKIP_SEED}" -eq 0 ]]; then
  echo "[2/4] Seeding test data..."
  if [[ -f "${SCRIPT_DIR}/seed-data.mjs" ]]; then
    echo "      Using Persona 7 seeder: performance/seed-data.mjs"
    BASE_URL="${BASE_URL}" node "${SCRIPT_DIR}/seed-data.mjs"
  fi
  if [[ ! -f "${SCRIPT_DIR}/.seed-manifest.json" ]]; then
    echo "      Running fallback seeder: performance/profiles/seed-fallback.mjs"
    BASE_URL="${BASE_URL}" node "${SCRIPT_DIR}/profiles/seed-fallback.mjs"
  fi
else
  echo "[2/4] Skipping seeding (--skip-seed)."
fi

# Helper to parse duration string like '25s' or '1m' to seconds
duration_to_sec() {
  local raw="$1"
  if [[ "${raw}" =~ ^([0-9]+)m$ ]]; then
    echo $(( BASH_REMATCH[1] * 60 ))
  else
    echo "${raw%s}"
  fi
}

# 3. Execute selected profiles with parallel Docker stats collection
echo "[3/4] Running performance profiles..."

for PROFILE in ${PROFILES}; do
  case "${PROFILE}" in
    load)
      echo ""
      echo ">>> Profile: LOAD TEST (${LOAD_LEVELS} VUs, ${LOAD_DURATION}/step)"
      LOAD_SCRIPT="${CUSTOM_K6_SCRIPT:-${SCRIPT_DIR}/profiles/load.js}"
      start_collector "${RUN_DIR}/load_docker_stats.csv" "load_init"
      for VUS in ${LOAD_LEVELS}; do
        echo "load_${VUS}vus" > "${PHASE_FILE}"
        echo "  -> Load step: ${VUS} VUs for ${LOAD_DURATION}..."
        k6 run \
          --insecure-skip-tls-verify \
          --summary-trend-stats="${SUMMARY_TREND_STATS}" \
          -e MODE=single \
          -e BASE_URL="${BASE_URL}" \
          -e FLOW="${FLOW}" \
          -e VUS="${VUS}" \
          -e DURATION="${LOAD_DURATION}" \
          -e REQ_TIMEOUT="${REQ_TIMEOUT}" \
          -e THINK_TIME="${THINK_TIME}" \
          --summary-export="${RUN_DIR}/summary_load_${VUS}.json" \
          "${LOAD_SCRIPT}" \
          > "${RUN_DIR}/console_load_${VUS}.txt" 2>&1 || true
        sleep 2
      done
      stop_collector
      echo "  -> Load Test finished. Cooldown ${COOLDOWN_SECONDS}s..."
      sleep "${COOLDOWN_SECONDS}"
      ;;

    stress)
      echo ""
      echo ">>> Profile: STRESS TEST (${STRESS_LEVELS} VUs, ${STRESS_DURATION}/step)"
      STRESS_SCRIPT="${CUSTOM_K6_SCRIPT:-${SCRIPT_DIR}/profiles/stress.js}"
      start_collector "${RUN_DIR}/stress_docker_stats.csv" "stress_init"
      for VUS in ${STRESS_LEVELS}; do
        echo "stress_${VUS}vus" > "${PHASE_FILE}"
        echo "  -> Stress step: ${VUS} VUs for ${STRESS_DURATION}..."
        k6 run \
          --insecure-skip-tls-verify \
          --summary-trend-stats="${SUMMARY_TREND_STATS}" \
          -e MODE=single \
          -e BASE_URL="${BASE_URL}" \
          -e FLOW="${FLOW}" \
          -e VUS="${VUS}" \
          -e DURATION="${STRESS_DURATION}" \
          -e REQ_TIMEOUT="${REQ_TIMEOUT}" \
          -e THINK_TIME="${THINK_TIME}" \
          --summary-export="${RUN_DIR}/summary_stress_${VUS}.json" \
          "${STRESS_SCRIPT}" \
          > "${RUN_DIR}/console_stress_${VUS}.txt" 2>&1 || true
        sleep 3
      done
      stop_collector
      echo "  -> Stress Test finished. Cooldown ${COOLDOWN_SECONDS}s..."
      sleep "${COOLDOWN_SECONDS}"
      ;;

    spike)
      echo ""
      echo ">>> Profile: SPIKE TEST (${SPIKE_BASE_VUS} -> ${SPIKE_VUS} -> ${SPIKE_BASE_VUS} VUs)"
      SPIKE_SCRIPT="${SCRIPT_DIR}/profiles/spike.js"
      BASE_S="$(duration_to_sec "${SPIKE_BASE_DURATION}")"
      SPIKE_S="$(duration_to_sec "${SPIKE_DURATION}")"
      REC_S="$(duration_to_sec "${SPIKE_RECOVERY_DURATION}")"

      cat > "${RUN_DIR}/spike_meta.json" <<EOF
{
  "base_vus": ${SPIKE_BASE_VUS},
  "spike_vus": ${SPIKE_VUS},
  "base_duration_s": ${BASE_S},
  "ramp_up_s": 5,
  "spike_duration_s": ${SPIKE_S},
  "ramp_down_s": 5,
  "recovery_duration_s": ${REC_S}
}
EOF

      start_collector "${RUN_DIR}/spike_docker_stats.csv" "spike_run"
      RAW_NDJSON="${RUN_DIR}/k6_timeseries.ndjson"
      k6 run \
        --insecure-skip-tls-verify \
        --summary-trend-stats="${SUMMARY_TREND_STATS}" \
        -e BASE_URL="${BASE_URL}" \
        -e FLOW="${FLOW}" \
        -e BASE_VUS="${SPIKE_BASE_VUS}" \
        -e SPIKE_VUS="${SPIKE_VUS}" \
        -e BASE_DURATION="${SPIKE_BASE_DURATION}" \
        -e SPIKE_DURATION="${SPIKE_DURATION}" \
        -e RECOVERY_DURATION="${SPIKE_RECOVERY_DURATION}" \
        -e REQ_TIMEOUT="${REQ_TIMEOUT}" \
        -e THINK_TIME="${THINK_TIME}" \
        --summary-export="${RUN_DIR}/summary_spike.json" \
        --out "json=${RAW_NDJSON}" \
        "${SPIKE_SCRIPT}" \
        > "${RUN_DIR}/console_spike.txt" 2>&1 || true
      stop_collector

      if [[ -f "${RAW_NDJSON}" ]]; then
        echo "  -> Aggregating spike time-series into 2s buckets..."
        compact_spike_ndjson "${RAW_NDJSON}" "${RUN_DIR}/spike_timeseries.csv" 2
        if [[ "${KEEP_RAW_NDJSON}" -eq 0 ]]; then
          rm -f "${RAW_NDJSON}"
        fi
      fi
      echo "  -> Spike Test finished. Cooldown ${COOLDOWN_SECONDS}s..."
      sleep "${COOLDOWN_SECONDS}"
      ;;

    ratelimit)
      echo ""
      echo ">>> Profile: PROTECTED BURST / RATE LIMIT VALIDATION (${RATELIMIT_VUS} VUs, ${RATELIMIT_DURATION})"
      start_collector "${RUN_DIR}/ratelimit_docker_stats.csv" "ratelimit_${RATELIMIT_VUS}vus"
      k6 run \
        --insecure-skip-tls-verify \
        --summary-trend-stats="${SUMMARY_TREND_STATS}" \
        -e MODE=single \
        -e BASE_URL="${BASE_URL}" \
        -e FLOW="${FLOW}" \
        -e VUS="${RATELIMIT_VUS}" \
        -e DURATION="${RATELIMIT_DURATION}" \
        -e REQ_TIMEOUT="${REQ_TIMEOUT}" \
        -e THINK_TIME="0.2" \
        --summary-export="${RUN_DIR}/summary_ratelimit_${RATELIMIT_VUS}.json" \
        "${SCRIPT_DIR}/profiles/load.js" \
        > "${RUN_DIR}/console_ratelimit_${RATELIMIT_VUS}.txt" 2>&1 || true
      stop_collector
      ;;

    *)
      echo "WARNING: Unknown profile '${PROFILE}' — skipping." >&2
      ;;
  esac
done

# Update 'latest' symlink
ln -sfn "${RUN_DIR}" "${RESULTS_ROOT}/latest"

# 4. Run statistical analysis, charts, and English report generation
if [[ "${SKIP_ANALYSIS}" -eq 0 ]]; then
  echo ""
  echo "[4/4] Generating tables, English PNG charts, and p3_performance_section.md..."
  python3 "${SCRIPT_DIR}/analyze_results.py" "${RUN_DIR}"
else
  echo "[4/4] Skipping analysis (--skip-analysis)."
fi

echo ""
echo "========================================================================"
echo " DONE! Artifacts available at: ${RUN_DIR}"
echo "  - Tables : ${RUN_DIR}/tables/"
echo "  - Charts : ${RUN_DIR}/charts/"
echo "  - Report : ${RUN_DIR}/p3_performance_section.md"
echo "========================================================================"
