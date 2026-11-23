#!/usr/bin/env bash
# =============================================================================
# Escenario de seguridad 2 - Reverse Proxy Pattern: demostracion antes/despues
# =============================================================================
# El mismo script se ejecuta en dos momentos:
#   1. En main (sin proxy): muestra la debilidad -> resultados EXPUESTO.
#   2. En la rama del escenario (con proxy): muestra la mitigacion -> MITIGADO.
#
# Cada verificacion observa un hecho reproducible con curl (puerto abierto,
# cabecera presente/ausente, codigo HTTP). La etiqueta es la interpretacion:
#   EXPUESTO  -> la debilidad esta presente.
#   MITIGADO  -> el Reverse Proxy la controla.
#   OK / FALLA -> verificacion funcional (que el sistema siga funcionando
#                 detras del proxy); solo aplica cuando el proxy existe.
#
# Uso (con el sistema levantado con docker compose up):
#   ./scripts/test-reverse-proxy.sh
#
# Codigo de salida: 0 solo si todo esta MITIGADO y OK.
# Requiere: bash, curl.
# =============================================================================
set -uo pipefail

PROXY_BASE="https://localhost"
APP_URL="https://app.localhost/"
PROFILE_URL="https://profile.localhost/login"

DIRECT_GATEWAY="http://localhost:8080"
DIRECT_FRONTEND="http://localhost:8081/"
DIRECT_PROFILE="http://localhost:8082/login"

# Endpoint publico conocido (no requiere JWT).
NEARBY_PATH="/api/messages/nearby?lat=4.6371&lng=-74.0834&radius=500"
# Endpoint publico que acepta POST, usado para la prueba de tamano.
LOGIN_PATH="/api/auth/login"
OVERSIZED_MB=7

# -k: acepta el certificado autofirmado temporal. La validacion del
# certificado es parte del Escenario 1 (scripts/test-secure-channel.sh).
CURL=(curl -sk --max-time 10)

if [[ -t 1 ]]; then
  RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; BOLD=$'\e[1m'; DIM=$'\e[2m'; RESET=$'\e[0m'
else
  RED=""; GREEN=""; YELLOW=""; BOLD=""; DIM=""; RESET=""
fi

exposed=0
mitigated=0
failed=0

report() { # report ESTADO "mensaje" ["detalle"]
  local status=$1 message=$2 detail=${3:-}
  case $status in
    EXPUESTO) exposed=$((exposed + 1));   printf '%s[EXPUESTO]%s %s' "$RED" "$RESET" "$message" ;;
    MITIGADO) mitigated=$((mitigated + 1)); printf '%s[MITIGADO]%s %s' "$GREEN" "$RESET" "$message" ;;
    OK)       printf '%s[OK]%s       %s' "$GREEN" "$RESET" "$message" ;;
    FALLA)    failed=$((failed + 1));     printf '%s[FALLA]%s    %s' "$RED" "$RESET" "$message" ;;
    N/A)      printf '%s[N/A]%s      %s' "$YELLOW" "$RESET" "$message" ;;
  esac
  [[ -n $detail ]] && printf ' %s(%s)%s' "$DIM" "$detail" "$RESET"
  printf '\n'
}

section() { printf '\n%s%s%s\n' "$BOLD" "$1" "$RESET"; }

# Devuelve el codigo HTTP, o "000" si no hubo conexion.
http_code() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$@" 2>/dev/null || true; }

# Devuelve las cabeceras de respuesta (sin cuerpo).
headers_of() { "${CURL[@]}" -o /dev/null -D - "$1" 2>/dev/null | tr -d '\r'; }

header_value() { # header_value "cabeceras" Nombre
  printf '%s\n' "$1" | awk -v name="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')" -F': ' \
    'tolower($1) == name { sub(/^[^:]*: /, ""); print; exit }'
}

# -----------------------------------------------------------------------------
# Deteccion del modo
# -----------------------------------------------------------------------------
if [[ $(http_code "$PROXY_BASE/healthz") == 200 ]]; then
  MODE=proxy
  APP_TARGET=$APP_URL
  PROFILE_TARGET=$PROFILE_URL
  API_BASE=$PROXY_BASE
else
  MODE=direct
  APP_TARGET=$DIRECT_FRONTEND
  PROFILE_TARGET=$DIRECT_PROFILE
  API_BASE=$DIRECT_GATEWAY
fi

printf '%sEscenario 2 - Reverse Proxy Pattern%s\n' "$BOLD" "$RESET"
if [[ $MODE == proxy ]]; then
  printf 'Perimetro detectado en %s (Reverse Proxy activo)\n' "$PROXY_BASE"
else
  printf 'No hay perimetro en %s: se prueban los servidores publicados directamente\n' "$PROXY_BASE"
fi

# -----------------------------------------------------------------------------
# 1. Superficie de ataque: puertos de aplicacion publicados al host
# -----------------------------------------------------------------------------
section "1. Superficie de ataque (puertos publicados al host)"
open_ports=0
for entry in "8080:gateway:$DIRECT_GATEWAY/actuator/health" \
             "8081:frontend:$DIRECT_FRONTEND" \
             "8082:profile-web:$DIRECT_PROFILE"; do
  port=${entry%%:*}; rest=${entry#*:}; name=${rest%%:*}; url=${rest#*:}
  code=$(http_code "$url")
  if [[ $code == 000 ]]; then
    report MITIGADO "$name no es accesible directamente en :$port" "conexion rechazada"
  else
    open_ports=$((open_ports + 1))
    report EXPUESTO "$name responde directamente en :$port" "HTTP $code"
  fi
done

if [[ $MODE == proxy ]]; then
  report MITIGADO "existe un unico punto de entrada" "$PROXY_BASE -> HTTP 200 en /healthz"
else
  report EXPUESTO "no hay un punto de entrada unico" "$open_ports servidores atienden al cliente por separado"
fi

# -----------------------------------------------------------------------------
# 2. Cabeceras de seguridad en las paginas que abre el usuario
# -----------------------------------------------------------------------------
section "2. Cabeceras de seguridad HTTP"
for target in "$APP_TARGET" "$PROFILE_TARGET"; do
  hdrs=$(headers_of "$target")
  if [[ -z $hdrs ]]; then
    report FALLA "no se pudo consultar $target"
    continue
  fi
  missing=()
  for h in X-Frame-Options X-Content-Type-Options Referrer-Policy; do
    [[ -z $(header_value "$hdrs" "$h") ]] && missing+=("$h")
  done
  if (( ${#missing[@]} == 0 )); then
    report MITIGADO "$target envia X-Frame-Options, X-Content-Type-Options y Referrer-Policy"
  else
    report EXPUESTO "$target no envia: ${missing[*]}" "clickjacking / MIME sniffing / fuga de Referer"
  fi
done

# -----------------------------------------------------------------------------
# 3. Divulgacion de informacion (fingerprinting del servidor)
# -----------------------------------------------------------------------------
section "3. Divulgacion de tecnologia y version"
for target in "$APP_TARGET" "$PROFILE_TARGET" "$API_BASE$NEARBY_PATH"; do
  hdrs=$(headers_of "$target")
  [[ -z $hdrs ]] && { report FALLA "no se pudo consultar $target"; continue; }
  server=$(header_value "$hdrs" Server)
  powered=$(header_value "$hdrs" X-Powered-By)
  leaks=()
  [[ $server =~ [0-9] ]] && leaks+=("Server: $server")
  [[ -n $powered ]] && leaks+=("X-Powered-By: $powered")
  if (( ${#leaks[@]} == 0 )); then
    report MITIGADO "$target no revela version ni tecnologia" "Server: ${server:-<ausente>}"
  else
    report EXPUESTO "$target revela ${leaks[*]}"
  fi
done

# -----------------------------------------------------------------------------
# 4. Limite de tamano en el borde
# -----------------------------------------------------------------------------
section "4. Limite de tamano de peticion"
code=$(head -c $((OVERSIZED_MB * 1024 * 1024)) /dev/zero \
  | "${CURL[@]}" --max-time 30 -o /dev/null -w '%{http_code}' -X POST \
      -H 'Content-Type: application/json' --data-binary @- "$API_BASE$LOGIN_PATH" 2>/dev/null || true)
if [[ $code == 413 ]]; then
  report MITIGADO "un cuerpo de $OVERSIZED_MB MB se rechaza en el borde" "HTTP 413, no llega al microservicio"
elif [[ $code == 000 ]]; then
  report FALLA "no se pudo enviar el cuerpo de $OVERSIZED_MB MB a $API_BASE$LOGIN_PATH"
else
  report EXPUESTO "un cuerpo de $OVERSIZED_MB MB llega hasta el microservicio de auth" "HTTP $code en vez de 413"
fi

# -----------------------------------------------------------------------------
# 5. Funcionamiento a traves del proxy (solo si el proxy existe)
# -----------------------------------------------------------------------------
section "5. Funcionamiento a traves del proxy"
if [[ $MODE == proxy ]]; then
  for entry in "app (Expo):$APP_URL" "profile-web (Next.js):$PROFILE_URL" \
               "API publica:$PROXY_BASE$NEARBY_PATH" "API en el origen de la app:https://app.localhost$NEARBY_PATH"; do
    name=${entry%%:*}; url=${entry#*:}
    code=$(http_code "$url")
    if [[ $code == 200 ]]; then report OK "$name responde a traves del proxy" "$url -> 200"
    else report FALLA "$name no responde a traves del proxy" "$url -> HTTP $code"; fi
  done

  # Handshake WebSocket sin ticket: el proxy debe entregar el upgrade al
  # gateway/socket-gateway, que lo rechaza por falta de ticket (401/403).
  # Un 404/502 indicaria que el proxy no enruta /api/ws.
  code=$("${CURL[@]}" --http1.1 -o /dev/null -w '%{http_code}' \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
    -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Origin: https://app.localhost' \
    "https://app.localhost/api/ws" 2>/dev/null || true)
  if [[ $code =~ ^(101|400|401|403)$ ]]; then
    report OK "el handshake WebSocket /api/ws llega al socket-gateway" "HTTP $code sin ticket"
  else
    report FALLA "el handshake WebSocket /api/ws no llega al socket-gateway" "HTTP $code"
  fi

  # La redireccion de :80 a :443 es parte del Escenario 1 (Persona 1).
  code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "http://localhost/" 2>/dev/null || true)
  if [[ $code =~ ^30[1278]$ ]]; then report OK "HTTP :80 redirige a HTTPS" "HTTP $code"
  else report FALLA "HTTP :80 no redirige a HTTPS" "HTTP $code"; fi
else
  report N/A "no hay proxy: se omiten las verificaciones funcionales"
fi

# -----------------------------------------------------------------------------
# Resumen
# -----------------------------------------------------------------------------
section "Resumen"
printf 'EXPUESTO: %d   MITIGADO: %d   FALLA: %d\n' "$exposed" "$mitigated" "$failed"
if [[ $MODE == proxy ]]; then
  printf 'Puntos de entrada publicados: 1 (reverse-proxy :80/:443)\n'
else
  printf 'Puntos de entrada publicados: %d (sin perimetro comun)\n' "$open_ports"
fi

(( exposed == 0 && failed == 0 ))
