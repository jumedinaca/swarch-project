#!/usr/bin/env bash
# ==============================================================================
# GeoPicto — Docker Container Resource Telemetry Collector (Persona 8)
# ==============================================================================
# Periodically snapshots CPU%, RAM (MB & %), Network I/O (MB), Block I/O (MB),
# and PIDs for all running containers of the GeoPicto Docker Compose stack
# (automatically discovering reverse-proxy and all 22-25 P2/P3 containers).
#
# Runs from the Docker host, so it is unaffected by Docker internal networks
# (Scenario 3: Network Segmentation).
#
# Usage:
#   ./performance/collect-metrics.sh \
#     --output performance/results/latest/stress_docker_stats.csv \
#     --interval 2 \
#     --phase-file performance/results/latest/.current_phase \
#     --host-info performance/results/latest/host_info.json
# ==============================================================================

set -euo pipefail

OUTPUT_CSV="performance/results/docker_stats.csv"
HOST_INFO_JSON=""
INTERVAL=2
DURATION=0
PHASE_FILE=""
DEFAULT_PHASE="default"
PROJECT="geopicto"
BASE_URL=""
RATE_LIMIT_MODE="unknown"
RUN_LABEL=""
WRITE_HOST_INFO_ONLY=0

usage() {
  cat <<'EOF'
Usage: collect-metrics.sh [options]

Options:
  --output <path>        CSV output path (default: performance/results/docker_stats.csv)
  --host-info <path>     Write host & environment metadata JSON to this path
  --host-info-only       Only write --host-info JSON and exit
  --interval <seconds>   Sampling interval in seconds (default: 2)
  --duration <seconds>   Stop after N seconds (0 = run until SIGINT/SIGTERM)
  --phase <name>         Static phase label (default: default)
  --phase-file <path>    File containing dynamic phase label (re-read each tick)
  --project <name>       Docker Compose project name (default: geopicto)
  --base-url <url>       Target URL recorded in host_info.json
  --rate-limit <state>   Rate limiting state (enabled|disabled|unknown)
  --label <name>         Run label recorded in host_info.json
  -h, --help             Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) OUTPUT_CSV="$2"; shift 2 ;;
    --host-info) HOST_INFO_JSON="$2"; shift 2 ;;
    --host-info-only) WRITE_HOST_INFO_ONLY=1; shift ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    --duration) DURATION="$2"; shift 2 ;;
    --phase) DEFAULT_PHASE="$2"; shift 2 ;;
    --phase-file) PHASE_FILE="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --rate-limit) RATE_LIMIT_MODE="$2"; shift 2 ;;
    --label) RUN_LABEL="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: 'docker' command not found in PATH." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: 'python3' command not found in PATH." >&2
  exit 1
fi

discover_container_ids() {
  local ids=""
  ids="$(docker ps --filter "label=com.docker.compose.project=${PROJECT}" --format '{{.ID}}' 2>/dev/null || true)"
  if [[ -z "${ids}" ]]; then
    ids="$(docker ps --filter "name=${PROJECT}" --format '{{.ID}}' 2>/dev/null || true)"
  fi
  printf '%s\n' "${ids}"
}

write_host_info() {
  local dest="$1"
  mkdir -p "$(dirname "${dest}")"

  local containers_json="[]"
  local names=""
  names="$(docker ps --filter "label=com.docker.compose.project=${PROJECT}" --format '{{.Names}}' 2>/dev/null || true)"
  if [[ -z "${names}" ]]; then
    names="$(docker ps --filter "name=${PROJECT}" --format '{{.Names}}' 2>/dev/null || true)"
  fi

  local docker_ver k6_ver node_ver git_branch git_commit
  docker_ver="$(docker --version 2>/dev/null || echo 'unknown')"
  k6_ver="$(k6 version 2>/dev/null | head -n 1 || echo 'not installed')"
  node_ver="$(node --version 2>/dev/null || echo 'not installed')"
  git_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
  git_commit="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

  python3 - "${dest}" "${PROJECT}" "${BASE_URL}" "${RATE_LIMIT_MODE}" "${RUN_LABEL}" \
    "${docker_ver}" "${k6_ver}" "${node_ver}" "${git_branch}" "${git_commit}" "${names}" <<'PY'
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone

(
    dest,
    project,
    base_url,
    rate_limit_mode,
    run_label,
    docker_ver,
    k6_ver,
    node_ver,
    git_branch,
    git_commit,
    names_raw,
) = sys.argv[1:]

def get_total_ram_gb():
    system = platform.system()
    try:
        if system == "Darwin":
            out = subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True).strip()
            return round(int(out) / (1024 ** 3), 2)
        if os.path.exists("/proc/meminfo"):
            with open("/proc/meminfo", "r", encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("MemTotal:"):
                        kb = int(line.split()[1])
                        return round(kb / (1024 ** 2), 2)
    except Exception:
        pass
    return None

def get_cpu_model():
    system = platform.system()
    try:
        if system == "Darwin":
            return subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"], text=True).strip()
        if os.path.exists("/proc/cpuinfo"):
            with open("/proc/cpuinfo", "r", encoding="utf-8") as fh:
                for line in fh:
                    if line.lower().startswith("model name"):
                        return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return platform.processor() or platform.machine()

containers = sorted([n.strip() for n in names_raw.splitlines() if n.strip()])
has_reverse_proxy = any("reverse-proxy" in c or "nginx" in c for c in containers)
protocol = "HTTPS" if base_url.lower().startswith("https://") else ("HTTP" if base_url else "unknown")

docker_mem_gb = None
docker_cpus = None
try:
    info_raw = subprocess.check_output(["docker", "info", "--format", "{{json .}}"], text=True, stderr=subprocess.DEVNULL)
    info = json.loads(info_raw)
    if info.get("MemTotal"):
        docker_mem_gb = round(float(info["MemTotal"]) / (1024 ** 3), 2)
    if info.get("NCPU"):
        docker_cpus = int(info["NCPU"])
except Exception:
    pass

payload = {
    "captured_at_utc": datetime.now(timezone.utc).isoformat(),
    "run_label": run_label or "unnamed",
    "git_branch": git_branch,
    "git_commit": git_commit,
    "target": {
        "base_url": base_url or "unknown",
        "protocol": protocol,
        "reverse_proxy_detected": has_reverse_proxy,
        "rate_limit_mode": rate_limit_mode,
        "compose_project": project,
    },
    "host": {
        "os": f"{platform.system()} {platform.release()}",
        "arch": platform.machine(),
        "cpu_model": get_cpu_model(),
        "cpu_cores_logical": os.cpu_count(),
        "ram_total_gb": get_total_ram_gb(),
    },
    "docker_engine": {
        "version": docker_ver,
        "allocated_cpus": docker_cpus,
        "allocated_ram_gb": docker_mem_gb,
        "active_containers_count": len(containers),
        "active_containers": containers,
    },
    "tools": {
        "k6": k6_ver,
        "node": node_ver,
        "python": platform.python_version(),
    },
}

with open(dest, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, indent=2)
PY
}

if [[ -n "${HOST_INFO_JSON}" ]]; then
  write_host_info "${HOST_INFO_JSON}"
fi

if [[ "${WRITE_HOST_INFO_ONLY}" -eq 1 ]]; then
  exit 0
fi

mkdir -p "$(dirname "${OUTPUT_CSV}")"

CSV_HEADER="timestamp_iso,epoch_s,elapsed_s,phase,container,tier,cpu_pct,mem_used_mb,mem_limit_mb,mem_pct,net_rx_mb,net_tx_mb,block_read_mb,block_write_mb,pids"
if [[ ! -f "${OUTPUT_CSV}" ]] || [[ ! -s "${OUTPUT_CSV}" ]]; then
  echo "${CSV_HEADER}" > "${OUTPUT_CSV}"
fi

STOP_REQUESTED=0
on_signal() {
  STOP_REQUESTED=1
}
trap on_signal INT TERM

START_EPOCH="$(date +%s)"
WARNS_PRINTED=0

read_current_phase() {
  if [[ -n "${PHASE_FILE}" && -f "${PHASE_FILE}" ]]; then
    local val
    val="$(tr -d '\r\n' < "${PHASE_FILE}" 2>/dev/null || true)"
    if [[ -n "${val}" ]]; then
      printf '%s' "${val}"
      return
    fi
  fi
  printf '%s' "${DEFAULT_PHASE}"
}

while [[ "${STOP_REQUESTED}" -eq 0 ]]; do
  TICK_START="$(date +%s)"
  ELAPSED=$((TICK_START - START_EPOCH))

  if [[ "${DURATION}" -gt 0 && "${ELAPSED}" -ge "${DURATION}" ]]; then
    break
  fi

  IDS="$(discover_container_ids)"
  if [[ -z "${IDS}" ]]; then
    if [[ "${WARNS_PRINTED}" -eq 0 ]]; then
      echo "[collect-metrics] WARNING: No running Docker containers found for project '${PROJECT}'." >&2
      WARNS_PRINTED=1
    fi
  else
    WARNS_PRINTED=0
    CURRENT_PHASE="$(read_current_phase)"
    TS_ISO="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

    # shellcheck disable=SC2086
    RAW_JSON="$(docker stats --no-stream --format '{{json .}}' ${IDS} 2>/dev/null || true)"
    if [[ -n "${RAW_JSON}" ]]; then
      # Los datos van por variable de entorno: con "python3 -" el stdin ya lo
      # ocupa el heredoc con el programa, así que un pipe se perdería.
      DOCKER_STATS_JSON="${RAW_JSON}" python3 - "${TS_ISO}" "${TICK_START}" "${ELAPSED}" "${CURRENT_PHASE}" "${PROJECT}" >> "${OUTPUT_CSV}" <<'PY'
import json
import os
import re
import sys

ts_iso, epoch_s, elapsed_s, phase, project = sys.argv[1:6]

UNIT_TO_BYTES = {
    "b": 1.0,
    "kb": 1e3,
    "mb": 1e6,
    "gb": 1e9,
    "tb": 1e12,
    "kib": 1024.0,
    "mib": 1024.0 ** 2,
    "gib": 1024.0 ** 3,
    "tib": 1024.0 ** 4,
}

EDGE_SERVICES = {"reverse-proxy", "nginx", "gateway", "api-gateway", "frontend", "profile-web"}
MICROSERVICES = {
    "auth",
    "messages",
    "moderation",
    "network",
    "profile",
    "rating",
    "reputation",
    "socket-gateway",
    "realtime",
    "email",
}
INFRA_SERVICES = {"redis", "rabbitmq", "minio", "mailpit"}

def parse_size_to_mb(token: str, binary: bool = False) -> float:
    token = token.strip()
    m = re.match(r"^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)$", token)
    if not m:
        return 0.0
    val = float(m.group(1))
    unit = m.group(2).lower()
    total_bytes = val * UNIT_TO_BYTES.get(unit, 0.0)
    divisor = (1024.0 ** 2) if binary else 1e6
    return total_bytes / divisor

def parse_pair(raw: str, binary: bool = False):
    parts = raw.split("/")
    if len(parts) != 2:
        return 0.0, 0.0
    return parse_size_to_mb(parts[0], binary=binary), parse_size_to_mb(parts[1], binary=binary)

def parse_pct(raw: str) -> float:
    try:
        return float(raw.strip().rstrip("%"))
    except Exception:
        return 0.0

def normalize_name(name: str) -> str:
    clean = name.strip().lstrip("/")
    prefix = f"{project}-"
    if clean.startswith(prefix):
        clean = clean[len(prefix):]
    # Remove standard compose replica suffix (-1, -2, ...)
    clean = re.sub(r"-\d+$", "", clean)
    return clean

def classify_tier(service: str) -> str:
    if service in EDGE_SERVICES:
        return "edge"
    if service.endswith("-db") or "postgres" in service or "mongo" in service:
        return "databases"
    if service in INFRA_SERVICES:
        return "infra"
    if service in MICROSERVICES:
        return "microservices"
    return "other"

safe_phase = phase.replace(",", "_")

for line in os.environ.get("DOCKER_STATS_JSON", "").splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        rec = json.loads(line)
    except json.JSONDecodeError:
        continue

    service = normalize_name(rec.get("Name", "unknown"))
    tier = classify_tier(service)
    cpu_pct = parse_pct(rec.get("CPUPerc", "0%"))
    mem_pct = parse_pct(rec.get("MemPerc", "0%"))
    mem_used_mb, mem_limit_mb = parse_pair(rec.get("MemUsage", "0B / 0B"), binary=True)
    net_rx_mb, net_tx_mb = parse_pair(rec.get("NetIO", "0B / 0B"), binary=False)
    blk_r_mb, blk_w_mb = parse_pair(rec.get("BlockIO", "0B / 0B"), binary=False)
    try:
        pids = int(str(rec.get("PIDs", "0")).strip())
    except ValueError:
        pids = 0

    print(
        f"{ts_iso},{epoch_s},{elapsed_s},{safe_phase},{service},{tier},"
        f"{cpu_pct:.2f},{mem_used_mb:.2f},{mem_limit_mb:.2f},{mem_pct:.2f},"
        f"{net_rx_mb:.3f},{net_tx_mb:.3f},{blk_r_mb:.3f},{blk_w_mb:.3f},{pids}"
    )
PY
    fi
  fi

  TICK_END="$(date +%s)"
  SPENT=$((TICK_END - TICK_START))
  SLEEP_FOR=$((INTERVAL - SPENT))
  if [[ "${SLEEP_FOR}" -gt 0 && "${STOP_REQUESTED}" -eq 0 ]]; then
    sleep "${SLEEP_FOR}" &
    wait $! 2>/dev/null || true
  fi
done
