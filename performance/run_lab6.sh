#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"
mkdir -p "${RESULTS_DIR}"

API_GATEWAY_URI="${API_GATEWAY_URI:-localhost:8080}"
ENDPOINT="${ENDPOINT:-/api/messages/nearby?lat=4.6371&lng=-74.0834&radius=500}"
DURATION="${DURATION:-30s}"
# Niveles de carga exactos de la guia del Laboratorio 6 (1, 50, 200, 500, 2000)
LOAD_LEVELS=(${LOAD_LEVELS:-1 50 200 500 2000})

echo "============================================================"
echo " Laboratory 6 — Performance Tests (Option 2: k6)"
echo " Target URI : http://${API_GATEWAY_URI}${ENDPOINT}"
echo " Duration   : ${DURATION} per load level"
echo " Load levels: ${LOAD_LEVELS[*]}"
echo "============================================================"

# 1. Elevar el limite de descriptores de archivo en macOS/Linux para soportar 2000 VUs
ulimit -n 65536 2>/dev/null || ulimit -n 10240 2>/dev/null || true

# 2. Verificar que el API Gateway y el endpoint respondan 200 OK
echo "[1/4] Verificando disponibilidad del API Gateway y endpoint..."
HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" "http://${API_GATEWAY_URI}${ENDPOINT}")"
if [[ "${HTTP_CODE}" != "200" ]]; then
  echo "ERROR: El endpoint http://${API_GATEWAY_URI}${ENDPOINT} respondio HTTP ${HTTP_CODE} (esperado 200)."
  exit 1
fi
echo "      OK (HTTP ${HTTP_CODE})"

# 3. Sembrar mensajes de prueba si el contenedor local messages-db esta corriendo
if docker ps --format '{{.Names}}' | grep -q 'messages-db'; then
  DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep 'messages-db' | head -n 1)"
  echo "[2/4] Sembrando mensajes geolocalizados en ${DB_CONTAINER}..."
  docker exec -i "${DB_CONTAINER}" psql -U postgres -d messages < "${SCRIPT_DIR}/seed_messages.sql" >/dev/null
  echo "      OK (100 mensajes PUBLISHED en Plaza Che)"
else
  echo "[2/4] Contenedor messages-db local no detectado (ejecucion remota); omitiendo seed local."
fi

# 4. Ejecutar cada nivel de carga y exportar metricas de k6
echo "[3/4] Ejecutando barrido de niveles de carga con k6..."
rm -f "${RESULTS_DIR}"/summary_vus_*.json

for VUS in "${LOAD_LEVELS[@]}"; do
  echo "  -> Corriendo k6 con VUS=${VUS} durante ${DURATION}..."
  k6 run \
    -e MODE=single \
    -e API_GATEWAY_URI="${API_GATEWAY_URI}" \
    -e ENDPOINT="${ENDPOINT}" \
    -e VUS="${VUS}" \
    -e DURATION="${DURATION}" \
    --summary-export="${RESULTS_DIR}/summary_vus_${VUS}.json" \
    "${SCRIPT_DIR}/performance_test.js" \
    | tee "${RESULTS_DIR}/console_vus_${VUS}.txt"
  sleep 2
done

# 5. Generar tabla, analisis del knee y grafica PNG
echo "[4/4] Generando curva de rendimiento y calculando el knee..."
python3 "${SCRIPT_DIR}/plot_results.py"
