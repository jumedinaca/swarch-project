#!/usr/bin/env bash
# =============================================================================
# test-network-segmentation.sh
# =============================================================================
# Pruebas de conectividad para validar el aislamiento de redes en Docker
# Compose (Network Segmentation Pattern — Escenario 3, Persona 4).
#
# Uso:
#   chmod +x scripts/test-network-segmentation.sh
#   docker compose up --build --wait
#   ./scripts/test-network-segmentation.sh
#
# Prerequisito: todos los contenedores deben estar en estado healthy.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuracion
# ---------------------------------------------------------------------------
COMPOSE="docker compose"
TIMEOUT_S=2        # Timeout para cada prueba de conexion (segundos)
PASS=0
FAIL=0
SKIP=0

# Colores (se desactivan si no hay terminal)
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; NC=''
fi

# ---------------------------------------------------------------------------
# Funcion de conectividad
# ---------------------------------------------------------------------------
# Intenta conexion TCP desde $1 hacia $2:$3 usando la primera herramienta
# disponible en el contenedor (nc, python3, python, node, bash /dev/tcp).
# Retorna: 0 = alcanzable, 1 = bloqueado, 2 = sin herramienta disponible,
#          3 = error ejecutando docker compose exec.

try_connect() {
  local src="$1" host="$2" port="$3"
  local rc=0
  $COMPOSE exec -T "$src" sh -c "
    if command -v nc >/dev/null 2>&1; then
      nc -z -w $TIMEOUT_S \"$host\" \"$port\" 2>/dev/null && exit 10 || exit 11
    elif command -v python3 >/dev/null 2>&1; then
      python3 -c \"import socket; s=socket.create_connection(('$host', $port), timeout=$TIMEOUT_S); s.close()\" 2>/dev/null && exit 10 || exit 11
    elif command -v python >/dev/null 2>&1; then
      python -c \"import socket; s=socket.create_connection(('$host', $port), timeout=$TIMEOUT_S); s.close()\" 2>/dev/null && exit 10 || exit 11
    elif command -v node >/dev/null 2>&1; then
      node -e \"require('net').connect($port,'$host').on('connect',function(){process.exit(0)}).on('error',function(){process.exit(1)});setTimeout(function(){process.exit(1)},${TIMEOUT_S}000)\" 2>/dev/null && exit 10 || exit 11
    elif command -v bash >/dev/null 2>&1; then
      if command -v timeout >/dev/null 2>&1; then
        timeout $TIMEOUT_S bash -c \"exec 3<>/dev/tcp/$host/$port\" 2>/dev/null && exit 10 || exit 11
      else
        bash -c \"exec 3<>/dev/tcp/$host/$port\" 2>/dev/null && exit 10 || exit 11
      fi
    else
      exit 12
    fi
  " >/dev/null 2>&1 || rc=$?
  case "$rc" in
    10) return 0 ;;
    11) return 1 ;;
    12) return 2 ;;
    *)  return 3 ;;
  esac
}

# ---------------------------------------------------------------------------
# Funciones de asercion
# ---------------------------------------------------------------------------

expect_reach() {
  local src="$1" host="$2" port="$3" desc="$4"
  local rc=0
  try_connect "$src" "$host" "$port" || rc=$?
  if [ "$rc" -eq 0 ]; then
    printf "  ${GREEN}✓ PASS${NC}  %s\n" "$desc"
    PASS=$((PASS + 1))
  elif [ "$rc" -eq 2 ]; then
    printf "  ${YELLOW}⊘ SKIP${NC}  %s  (sin herramienta de red en el contenedor)\n" "$desc"
    SKIP=$((SKIP + 1))
  elif [ "$rc" -eq 3 ]; then
    printf "  ${RED}✗ FAIL${NC}  %s  — error ejecutando docker compose exec en %s\n" "$desc" "$src"
    FAIL=$((FAIL + 1))
  else
    printf "  ${RED}✗ FAIL${NC}  %s  — esperado ALCANZABLE, resultado BLOQUEADO\n" "$desc"
    FAIL=$((FAIL + 1))
  fi
}

expect_block() {
  local src="$1" host="$2" port="$3" desc="$4"
  local rc=0
  try_connect "$src" "$host" "$port" || rc=$?
  if [ "$rc" -eq 1 ]; then
    printf "  ${GREEN}✓ PASS${NC}  %s\n" "$desc"
    PASS=$((PASS + 1))
  elif [ "$rc" -eq 2 ]; then
    printf "  ${YELLOW}⊘ SKIP${NC}  %s  (sin herramienta — no se pudo verificar bloqueo)\n" "$desc"
    SKIP=$((SKIP + 1))
  elif [ "$rc" -eq 3 ]; then
    printf "  ${RED}✗ FAIL${NC}  %s  — error ejecutando docker compose exec en %s\n" "$desc" "$src"
    FAIL=$((FAIL + 1))
  else
    printf "  ${RED}✗ FAIL${NC}  %s  — esperado BLOQUEADO, resultado ALCANZABLE\n" "$desc"
    FAIL=$((FAIL + 1))
  fi
}

# ---------------------------------------------------------------------------
# Verificar que el sistema está levantado
# ---------------------------------------------------------------------------
echo ""
printf "${BOLD}═══════════════════════════════════════════════════════════════${NC}\n"
printf "${BOLD}  Network Segmentation Test Suite — GeoPicto Prototype 3     ${NC}\n"
printf "${BOLD}  Escenario 3: Network Segmentation Pattern (Persona 4)      ${NC}\n"
printf "${BOLD}═══════════════════════════════════════════════════════════════${NC}\n"
echo ""

# Verificar que los contenedores estan corriendo
RUNNING=$($COMPOSE ps --status running --format '{{.Name}}' 2>/dev/null | wc -l)
if [ "$RUNNING" -lt 10 ]; then
  printf "${RED}ERROR:${NC} Solo %d contenedores estan corriendo. Ejecuta primero:\n" "$RUNNING"
  echo "  docker compose up --build --wait"
  exit 1
fi
printf "${CYAN}▸ %d contenedores detectados en ejecucion${NC}\n\n" "$RUNNING"

# ==========================================================================
# PRUEBAS POSITIVAS (debe haber conectividad)
# ==========================================================================
printf "${BOLD}━━━ PRUEBAS POSITIVAS (conectividad esperada) ━━━${NC}\n\n"

# --- edge_net: Reverse Proxy / Frontends → Gateway & Frontends ---
printf "  ${BOLD}edge_net — Reverse Proxy y Frontends${NC}\n"
expect_reach reverse-proxy  gateway         8080 "reverse-proxy → gateway:8080 (edge_net)"
expect_reach reverse-proxy  frontend        80   "reverse-proxy → frontend:80 (edge_net)"
expect_reach reverse-proxy  profile-web     3000 "reverse-proxy → profile-web:3000 (edge_net)"
expect_reach frontend       gateway         8080 "frontend → gateway:8080 (edge_net)"
expect_reach profile-web    gateway         8080 "profile-web → gateway:8080 (edge_net)"
echo ""

# --- gateway_net: Gateway → Microservicios HTTP ---
printf "  ${BOLD}gateway_net — Gateway → Microservicios HTTP${NC}\n"
expect_reach gateway        auth            8080 "gateway → auth:8080 (gateway_net)"
expect_reach gateway        messages        8080 "gateway → messages:8080 (gateway_net)"
expect_reach gateway        network         8080 "gateway → network:8080 (gateway_net)"
expect_reach gateway        profile         8080 "gateway → profile:8080 (gateway_net)"
expect_reach gateway        rating          8080 "gateway → rating:8080 (gateway_net)"
expect_reach gateway        reputation      8080 "gateway → reputation:8080 (gateway_net)"
expect_reach gateway        socket-gateway  8080 "gateway → socket-gateway:8080 (gateway_net)"
echo ""

# --- broker_net: Servicios → RabbitMQ ---
printf "  ${BOLD}broker_net — Servicios → RabbitMQ (AMQP)${NC}\n"
expect_reach auth           rabbitmq        5672 "auth → rabbitmq:5672 (broker_net)"
expect_reach messages       rabbitmq        5672 "messages → rabbitmq:5672 (broker_net)"
expect_reach moderation     rabbitmq        5672 "moderation → rabbitmq:5672 (broker_net)"
expect_reach network        rabbitmq        5672 "network → rabbitmq:5672 (broker_net)"
expect_reach profile        rabbitmq        5672 "profile → rabbitmq:5672 (broker_net)"
expect_reach rating         rabbitmq        5672 "rating → rabbitmq:5672 (broker_net)"
expect_reach reputation     rabbitmq        5672 "reputation → rabbitmq:5672 (broker_net)"
expect_reach email          rabbitmq        5672 "email → rabbitmq:5672 (broker_net)"
expect_reach socket-gateway rabbitmq        5672 "socket-gateway → rabbitmq:5672 (broker_net)"
echo ""

# --- redis_net: Clientes autorizados → Redis ---
printf "  ${BOLD}redis_net — Clientes autorizados → Redis${NC}\n"
expect_reach gateway        redis           6379 "gateway → redis:6379 (redis_net — rate-limit/blacklist)"
expect_reach auth           redis           6379 "auth → redis:6379 (redis_net — token blacklist)"
expect_reach socket-gateway redis           6379 "socket-gateway → redis:6379 (redis_net — tickets/pubsub)"
echo ""

# --- *_db_net: Servicios → Sus propias bases de datos ---
printf "  ${BOLD}*_db_net — Servicios → Sus bases de datos${NC}\n"
expect_reach auth           auth-db         5432 "auth → auth-db:5432 (auth_db_net)"
expect_reach messages       messages-db     5432 "messages → messages-db:5432 (messages_db_net)"
expect_reach moderation     moderation-db   5432 "moderation → moderation-db:5432 (moderation_db_net)"
expect_reach network        network-db      27017 "network → network-db:27017 (network_db_net)"
expect_reach profile        profile-db      5432 "profile → profile-db:5432 (profile_data_net)"
expect_reach profile        minio           9000 "profile → minio:9000 (profile_data_net)"
expect_reach rating         rating-db       5432 "rating → rating-db:5432 (rating_db_net)"
expect_reach reputation     reputation-db   5432 "reputation → reputation-db:5432 (reputation_db_net)"
expect_reach email          email-db        5432 "email → email-db:5432 (email_data_net)"
expect_reach email          mailpit         1025 "email → mailpit:1025 SMTP (email_data_net)"
echo ""

# ==========================================================================
# PRUEBAS NEGATIVAS (debe estar bloqueado — Lateral Movement Prevention)
# ==========================================================================
printf "${BOLD}━━━ PRUEBAS NEGATIVAS (aislamiento esperado) ━━━${NC}\n\n"

# --- edge_net ✗ Infra: Reverse Proxy y Frontends no deben alcanzar infra/servicios internos ---
printf "  ${BOLD}edge_net ✗ Infraestructura y microservicios internos${NC}\n"
expect_block reverse-proxy  auth            8080 "reverse-proxy ✗ auth:8080 (fuera de gateway_net)"
expect_block reverse-proxy  auth-db         5432 "reverse-proxy ✗ auth-db:5432"
expect_block reverse-proxy  redis           6379 "reverse-proxy ✗ redis:6379"
expect_block reverse-proxy  rabbitmq        5672 "reverse-proxy ✗ rabbitmq:5672"
expect_block reverse-proxy  minio           9000 "reverse-proxy ✗ minio:9000"
expect_block frontend       auth-db         5432 "frontend ✗ auth-db:5432"
expect_block frontend       messages-db     5432 "frontend ✗ messages-db:5432"
expect_block frontend       redis           6379 "frontend ✗ redis:6379"
expect_block frontend       rabbitmq        5672 "frontend ✗ rabbitmq:5672"
expect_block frontend       minio           9000 "frontend ✗ minio:9000"
expect_block profile-web    auth-db         5432 "profile-web ✗ auth-db:5432"
expect_block profile-web    redis           6379 "profile-web ✗ redis:6379"
echo ""

# --- gateway ✗ Bases de datos, workers internos y RabbitMQ ---
printf "  ${BOLD}gateway ✗ Bases de datos, workers no enrutados y broker${NC}\n"
expect_block gateway        auth-db         5432 "gateway ✗ auth-db:5432"
expect_block gateway        messages-db     5432 "gateway ✗ messages-db:5432"
expect_block gateway        profile-db      5432 "gateway ✗ profile-db:5432"
expect_block gateway        rating-db       5432 "gateway ✗ rating-db:5432"
expect_block gateway        reputation-db   5432 "gateway ✗ reputation-db:5432"
expect_block gateway        network-db      27017 "gateway ✗ network-db:27017"
expect_block gateway        moderation-db   5432 "gateway ✗ moderation-db:5432"
expect_block gateway        email-db        5432 "gateway ✗ email-db:5432"
expect_block gateway        moderation      8080 "gateway ✗ moderation:8080 (fuera de gateway_net y broker_net)"
expect_block gateway        email           8080 "gateway ✗ email:8080 (fuera de gateway_net y broker_net)"
expect_block gateway        rabbitmq        5672 "gateway ✗ rabbitmq:5672 (fuera de broker_net)"
echo ""

# --- Servicios no autorizados ✗ Redis (aislamiento de redis_net) ---
printf "  ${BOLD}Servicios no autorizados ✗ Redis (aislamiento de redis_net)${NC}\n"
expect_block messages       redis           6379 "messages ✗ redis:6379"
expect_block network        redis           6379 "network ✗ redis:6379"
expect_block profile        redis           6379 "profile ✗ redis:6379"
expect_block rating         redis           6379 "rating ✗ redis:6379"
expect_block reputation     redis           6379 "reputation ✗ redis:6379"
expect_block moderation     redis           6379 "moderation ✗ redis:6379"
expect_block email          redis           6379 "email ✗ redis:6379"
echo ""

# --- Cross-DB: Servicios no deben alcanzar BDs de otros servicios ---
printf "  ${BOLD}Aislamiento cross-database (cada servicio solo alcanza su BD)${NC}\n"
expect_block auth           messages-db     5432 "auth ✗ messages-db:5432"
expect_block auth           network-db      27017 "auth ✗ network-db:27017"
expect_block auth           profile-db      5432 "auth ✗ profile-db:5432"
expect_block messages       auth-db         5432 "messages ✗ auth-db:5432"
expect_block messages       profile-db      5432 "messages ✗ profile-db:5432"
expect_block messages       rating-db       5432 "messages ✗ rating-db:5432"
expect_block network        auth-db         5432 "network ✗ auth-db:5432"
expect_block network        messages-db     5432 "network ✗ messages-db:5432"
expect_block profile        auth-db         5432 "profile ✗ auth-db:5432"
expect_block profile        messages-db     5432 "profile ✗ messages-db:5432"
expect_block rating         auth-db         5432 "rating ✗ auth-db:5432"
expect_block reputation     auth-db         5432 "reputation ✗ auth-db:5432"
expect_block moderation     auth-db         5432 "moderation ✗ auth-db:5432"
expect_block moderation     messages-db     5432 "moderation ✗ messages-db:5432"
expect_block email          auth-db         5432 "email ✗ auth-db:5432"
expect_block email          messages-db     5432 "email ✗ messages-db:5432"
echo ""

# --- Infra ✗ Infra: Bases de datos no se alcanzan entre si ---
printf "  ${BOLD}Aislamiento entre bases de datos${NC}\n"
expect_block auth-db        messages-db     5432 "auth-db ✗ messages-db:5432"
expect_block auth-db        profile-db      5432 "auth-db ✗ profile-db:5432"
expect_block messages-db    auth-db         5432 "messages-db ✗ auth-db:5432"
expect_block redis          auth-db         5432 "redis ✗ auth-db:5432"
expect_block rabbitmq       auth-db         5432 "rabbitmq ✗ auth-db:5432"
echo ""

# ==========================================================================
# Resumen
# ==========================================================================
TOTAL=$((PASS + FAIL + SKIP))
echo ""
printf "${BOLD}═══════════════════════════════════════════════════════════════${NC}\n"
printf "${BOLD}  RESULTADO${NC}\n"
printf "${BOLD}═══════════════════════════════════════════════════════════════${NC}\n"
printf "  Total:     %d pruebas\n" "$TOTAL"
printf "  ${GREEN}Pasaron:   %d${NC}\n" "$PASS"
if [ "$FAIL" -gt 0 ]; then
  printf "  ${RED}Fallaron:  %d${NC}\n" "$FAIL"
else
  printf "  Fallaron:  0\n"
fi
if [ "$SKIP" -gt 0 ]; then
  printf "  ${YELLOW}Omitidas:  %d${NC}\n" "$SKIP"
fi
echo ""

if [ "$FAIL" -eq 0 ]; then
  printf "${GREEN}${BOLD}✓ La segmentacion de redes esta correctamente implementada.${NC}\n"
  exit 0
else
  printf "${RED}${BOLD}✗ Se detectaron %d fallo(s) en el aislamiento de redes.${NC}\n" "$FAIL"
  exit 1
fi
