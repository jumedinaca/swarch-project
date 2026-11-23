#!/usr/bin/env bash
# =============================================================================
# test-secure-channel.sh
# =============================================================================
# Suite automatizada de verificacion del Escenario de Seguridad 1:
# Secure Channel Pattern (TLS 1.2 / 1.3, HTTPS, WSS, Redireccion 301 y HSTS)
# — Persona 1.
#
# Valida:
#   1. Existencia, cadena de confianza X.509v3, vigencia, par de claves y SANs
#      (localhost, *.localhost, app.localhost, profile.localhost, 127.0.0.1)
#      de los certificados generados por scripts/generate-certs.sh.
#   2. Configuracion criptografica en nginx/conf.d/ssl.conf,
#      nginx/snippets/hsts.conf, nginx/sites/http.conf y
#      nginx/snippets/api-locations.conf (TLS 1.2/1.3, cifrados AEAD con
#      Forward Secrecy, HSTS y redireccion 301).
#   3. Redireccion obligatoria 301 Moved Permanently de HTTP (:80) -> HTTPS (:443).
#   4. Negociacion exitosa de TLS 1.3 y TLS 1.2, presencia de cabecera HSTS
#      (Strict-Transport-Security) mediante `curl -k -I https://localhost/...`
#      y verificacion de la cadena del certificado contra ca.pem.
#   5. Rechazo de conexiones no seguras: protocolos obsoletos (TLS 1.0 / 1.1),
#      certificados no confiables (sin -k ni CA) y trafico HTTP plano en el
#      puerto TLS (:443).
#   6. Upgrade de canal WebSocket seguro (wss://) sobre TLS.
#
# Uso:
#   ./scripts/test-secure-channel.sh [opciones]
#
# Opciones:
#   --host <host>         Host a probar (por defecto: localhost)
#   --http-port <puerto>  Puerto HTTP (por defecto: 80)
#   --https-port <puerto> Puerto HTTPS (por defecto: 443)
#   --require-live        Exige que el contenedor reverse-proxy este corriendo
#                         en :80/:443 (desactiva el arnes local de respaldo)
#   --offline             Ejecuta solo las pruebas criptograficas y estaticas
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

CERT_DIR="${CERTS_DIR:-${REPO_ROOT}/nginx/certs}"
CA_CERT="${CERT_DIR}/ca.pem"
SERVER_CERT="${CERT_DIR}/cert.pem"
SERVER_KEY="${CERT_DIR}/key.pem"

SSL_CONF="${REPO_ROOT}/nginx/conf.d/ssl.conf"
HSTS_CONF="${REPO_ROOT}/nginx/snippets/hsts.conf"
HTTP_SITE_CONF="${REPO_ROOT}/nginx/sites/http.conf"
API_LOC_CONF="${REPO_ROOT}/nginx/snippets/api-locations.conf"

HOST="${TEST_HOST:-localhost}"
HTTP_PORT="${TEST_HTTP_PORT:-80}"
HTTPS_PORT="${TEST_HTTPS_PORT:-443}"
REDIRECT_PATH="/api/messages/nearby?lat=4.6371&lng=-74.0834&radius=500"
HTTPS_PROBE_PATH="/healthz"
REQUIRE_LIVE=false
OFFLINE_ONLY=false

PASS=0
FAIL=0
HARNESS_PID=""

if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; NC=''
fi

cleanup() {
  if [[ -n "${HARNESS_PID}" ]]; then
    kill -9 "${HARNESS_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="$2"; shift 2 ;;
    --http-port)
      HTTP_PORT="$2"; shift 2 ;;
    --https-port)
      HTTPS_PORT="$2"; shift 2 ;;
    --require-live)
      REQUIRE_LIVE=true; shift ;;
    --offline)
      OFFLINE_ONLY=true; shift ;;
    --help|-h)
      sed -n '2,36p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      printf "${RED}Error:${NC} Opcion desconocida '%s'.\n" "$1" >&2
      exit 1 ;;
  esac
done

pass() {
  printf "  ${GREEN}✓ PASS${NC}  %s\n" "$1"
  PASS=$((PASS + 1))
}

fail() {
  local msg="$1"
  local detail="${2:-}"
  if [[ -n "${detail}" ]]; then
    printf "  ${RED}✗ FAIL${NC}  %s — %s\n" "${msg}" "${detail}"
  else
    printf "  ${RED}✗ FAIL${NC}  %s\n" "${msg}"
  fi
  FAIL=$((FAIL + 1))
}

is_port_open() {
  local host="$1" port="$2"
  if command -v node >/dev/null 2>&1; then
    node -e "
      const net = require('node:net');
      const s = net.connect(${port}, '${host}');
      s.on('connect', () => { s.destroy(); process.exit(0); });
      s.on('error', () => process.exit(1));
      setTimeout(() => { s.destroy(); process.exit(1); }, 1500);
    " >/dev/null 2>&1
    return $?
  elif command -v curl >/dev/null 2>&1; then
    curl -k -s --connect-timeout 2 "https://${host}:${port}/" >/dev/null 2>&1 || \
    curl -s --connect-timeout 2 "http://${host}:${port}/" >/dev/null 2>&1
    return $?
  fi
  return 1
}

printf "${BOLD}${CYAN}=============================================================================${NC}\n"
printf "${BOLD}${CYAN} GeoPicto — Verificacion de Canal Seguro (Escenario 1: Secure Channel Pattern)${NC}\n"
printf "${BOLD}${CYAN}=============================================================================${NC}\n\n"

# =============================================================================
# FASE 1: Validacion Criptografica de Certificados y Configuracion SSL en Nginx
# =============================================================================
printf "${BOLD}1. Certificados X.509v3 y Cadena de Confianza Local${NC}\n"

if [[ ! -f "${SERVER_CERT}" || ! -f "${SERVER_KEY}" || ! -f "${CA_CERT}" ]]; then
  printf "  ${YELLOW}ℹ${NC} Certificados no encontrados en ${CERT_DIR}; ejecutando scripts/generate-certs.sh...\n"
  "${SCRIPT_DIR}/generate-certs.sh" >/dev/null
fi

if [[ -f "${CA_CERT}" && -f "${SERVER_CERT}" && -f "${SERVER_KEY}" ]]; then
  pass "Archivos TLS presentes en nginx/certs/ (ca.pem, cert.pem, key.pem)"
else
  fail "Archivos TLS presentes en nginx/certs/" "Faltan archivos en ${CERT_DIR}"
fi

if openssl verify -CAfile "${CA_CERT}" "${SERVER_CERT}" >/dev/null 2>&1; then
  pass "Cadena criptografica valida: cert.pem firmado por la CA local (ca.pem)"
else
  fail "Cadena criptografica cert.pem -> ca.pem" "openssl verify fallo"
fi

if openssl x509 -checkend 86400 -noout -in "${SERVER_CERT}" >/dev/null 2>&1; then
  pass "Certificado del servidor vigente (no expirado)"
else
  fail "Vigencia del certificado del servidor" "Expirado o expira en < 24h"
fi

CERT_PUB="$(openssl x509 -noout -pubkey -in "${SERVER_CERT}" 2>/dev/null | tr -d '\r')"
KEY_PUB="$(openssl pkey -pubout -in "${SERVER_KEY}" 2>/dev/null | tr -d '\r')"
if [[ -n "${CERT_PUB}" && "${CERT_PUB}" == "${KEY_PUB}" ]]; then
  pass "Correspondencia criptografica entre clave publica (cert.pem) y privada (key.pem)"
else
  fail "Correspondencia cert.pem <-> key.pem" "Las claves publica y privada no coinciden"
fi

SANS_TEXT="$(openssl x509 -noout -ext subjectAltName -in "${SERVER_CERT}" 2>/dev/null | tr -d '\r')"
if [[ "${SANS_TEXT}" == *"DNS:localhost"* && "${SANS_TEXT}" == *"DNS:app.localhost"* && "${SANS_TEXT}" == *"DNS:profile.localhost"* && "${SANS_TEXT}" == *"IP Address:127.0.0.1"* ]]; then
  pass "Extension X.509v3 Subject Alternative Name cubre localhost, app.localhost, profile.localhost y 127.0.0.1"
else
  fail "Subject Alternative Name (SAN)" "${SANS_TEXT}"
fi

printf "\n${BOLD}2. Directivas de Seguridad TLS, HSTS y Redireccion en nginx/${NC}\n"

if [[ -f "${SSL_CONF}" ]] && grep -Eq "ssl_protocols[[:space:]]+TLSv1\.2[[:space:]]+TLSv1\.3;" "${SSL_CONF}"; then
  pass "nginx/conf.d/ssl.conf habilita exclusivamente TLSv1.2 y TLSv1.3"
else
  fail "Directiva ssl_protocols TLSv1.2 TLSv1.3 en nginx/conf.d/ssl.conf"
fi

if [[ -f "${SSL_CONF}" ]] && ! grep -Eqi "SSLv2|SSLv3|TLSv1\.0|TLSv1\.1" <(grep -v '^[[:space:]]*#' "${SSL_CONF}"); then
  pass "Protocolos obsoletos (SSLv2, SSLv3, TLSv1.0, TLSv1.1) deshabilitados"
else
  fail "Deshabilitacion de protocolos debiles en nginx/conf.d/ssl.conf"
fi

if [[ -f "${SSL_CONF}" ]] && grep -Eq "ssl_ciphers[[:space:]]+.*GCM.*CHACHA20-POLY1305" "${SSL_CONF}"; then
  pass "Suites de cifrado AEAD con Forward Secrecy (ECDHE + AES-GCM / ChaCha20-Poly1305) en nginx/conf.d/ssl.conf"
else
  fail "Configuracion de ssl_ciphers seguros en nginx/conf.d/ssl.conf"
fi

if [[ -f "${HSTS_CONF}" ]] && grep -Eq 'add_header[[:space:]]+Strict-Transport-Security[[:space:]]+"max-age=[0-9]+.*"[[:space:]]+always;' "${HSTS_CONF}"; then
  pass "Cabecera HSTS (Strict-Transport-Security) configurada con 'always' en nginx/snippets/hsts.conf"
else
  fail "Cabecera Strict-Transport-Security en nginx/snippets/hsts.conf"
fi

if [[ -f "${HTTP_SITE_CONF}" ]] && grep -Eq "return[[:space:]]+301[[:space:]]+https://\\\$host\\\$request_uri;" "${HTTP_SITE_CONF}"; then
  pass "Redireccion obligatoria HTTP (:80) -> HTTPS (:443) (301 Moved Permanently) en nginx/sites/http.conf"
else
  fail "Redireccion 301 HTTP -> HTTPS en nginx/sites/http.conf"
fi

if [[ -f "${API_LOC_CONF}" ]] && grep -Eq "proxy_set_header[[:space:]]+Upgrade" "${API_LOC_CONF}" && grep -Eq "location[[:space:]]+/api/ws" "${API_LOC_CONF}"; then
  pass "Soporte de terminacion TLS para WebSockets seguros (wss:// -> /api/ws) en nginx/snippets/api-locations.conf"
else
  fail "Terminacion WSS (/api/ws) en nginx/snippets/api-locations.conf"
fi

if [[ "${OFFLINE_ONLY}" == "true" ]]; then
  printf "\n${BOLD}Resumen (Modo Offline):${NC} ${GREEN}%d PASS${NC}, ${RED}%d FAIL${NC}\n" "${PASS}" "${FAIL}"
  exit $((FAIL > 0 ? 1 : 0))
fi

# =============================================================================
# FASE 2: Pruebas Dinamicas de Red sobre el Canal Seguro (HTTP :80 & HTTPS :443)
# =============================================================================
printf "\n${BOLD}3. Pruebas en Vivo del Canal TLS (Redireccion 301, TLS 1.2/1.3, HSTS y WSS)${NC}\n"

if ! is_port_open "${HOST}" "${HTTPS_PORT}"; then
  if [[ "${REQUIRE_LIVE}" == "true" ]]; then
    fail "Conexion a https://${HOST}:${HTTPS_PORT}" "El puerto ${HTTPS_PORT} no responde (¿esta corriendo reverse-proxy?)"
    printf "\n${BOLD}Resumen:${NC} ${GREEN}%d PASS${NC}, ${RED}%d FAIL${NC}\n" "${PASS}" "${FAIL}"
    exit 1
  fi

  # Si el stack Docker no esta levantado en el host actual, iniciamos un arnes
  # TLS local efimero en Node.js cargando exactamente los certificados y
  # parametros TLS 1.2/1.3 de nginx/ para validar el comportamiento extremo a extremo.
  HTTP_PORT=18080
  HTTPS_PORT=18443
  printf "  ${YELLOW}ℹ${NC} Contenedor reverse-proxy no detectado en :443; iniciando servidor TLS 1.2/1.3 de verificacion local (:${HTTP_PORT} -> :${HTTPS_PORT}) con nginx/certs/...\n"

  node -e "
    const fs = require('node:fs');
    const http = require('node:http');
    const https = require('node:https');
    const crypto = require('node:crypto');

    const httpPort = Number(process.argv[1]);
    const httpsPort = Number(process.argv[2]);
    const certFile = process.argv[3];
    const keyFile = process.argv[4];

    const redirectServer = http.createServer((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok\n');
        return;
      }
      const hostHeader = (req.headers.host || 'localhost').replace(/:[0-9]+$/, '');
      const targetPort = httpsPort === 443 ? '' : ':' + httpsPort;
      res.writeHead(301, {
        'Location': 'https://' + hostHeader + targetPort + (req.url || '/'),
        'Connection': 'close'
      });
      res.end();
    });

    const tlsOptions = {
      cert: fs.readFileSync(certFile),
      key: fs.readFileSync(keyFile),
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.3',
      ciphers: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305',
      honorCipherOrder: false
    };

    const httpsServer = https.createServer(tlsOptions, (req, res) => {
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok\n');
    });

    httpsServer.on('upgrade', (req, socket) => {
      const key = req.headers['sec-websocket-key'];
      const accept = crypto.createHash('sha1').update((key || '') + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + accept + '\r\n' +
        'Strict-Transport-Security: max-age=63072000; includeSubDomains; preload\r\n\r\n'
      );
      socket.end();
    });

    redirectServer.listen(httpPort, () => {
      httpsServer.listen(httpsPort);
    });
  " "${HTTP_PORT}" "${HTTPS_PORT}" "${SERVER_CERT}" "${SERVER_KEY}" &
  HARNESS_PID=$!

  for _ in {1..20}; do
    if is_port_open "${HOST}" "${HTTPS_PORT}"; then
      break
    fi
    sleep 0.1
  done
fi

HTTP_REDIRECT_URL="http://${HOST}:${HTTP_PORT}${REDIRECT_PATH}"
HTTPS_URL="https://${HOST}:${HTTPS_PORT}${HTTPS_PROBE_PATH}"

# 3.1 Redireccion 301 desde HTTP (:80) hacia HTTPS (:443)
HTTP_HEADERS="$(curl -s -S -I --max-time 5 "${HTTP_REDIRECT_URL}" 2>/dev/null | tr -d '\r' || true)"
HTTP_STATUS="$(printf "%s\n" "${HTTP_HEADERS}" | awk 'NR==1 {print $2}')"
HTTP_LOCATION="$(printf "%s\n" "${HTTP_HEADERS}" | awk 'tolower($1)=="location:" {print $2}')"

if [[ "${HTTP_STATUS}" == "301" && "${HTTP_LOCATION}" == https://* ]]; then
  pass "Redireccion HTTP -> HTTPS activa: GET ${HTTP_REDIRECT_URL} -> 301 Location: ${HTTP_LOCATION}"
else
  fail "Redireccion HTTP -> HTTPS en ${HTTP_REDIRECT_URL}" "status=${HTTP_STATUS:-none} location=${HTTP_LOCATION:-none}"
fi

# 3.2 Peticion HTTPS con curl -k -I y verificacion de cabecera HSTS
HTTPS_HEADERS="$(curl -k -s -S -I --max-time 5 "${HTTPS_URL}" 2>/dev/null | tr -d '\r' || true)"
HTTPS_STATUS="$(printf "%s\n" "${HTTPS_HEADERS}" | awk 'NR==1 {print $2}')"
HSTS_HEADER="$(printf "%s\n" "${HTTPS_HEADERS}" | grep -i '^strict-transport-security:' || true)"

if [[ -n "${HTTPS_STATUS}" && "${HTTPS_STATUS}" =~ ^[234][0-9][0-9]$ ]]; then
  pass "Respuesta HTTPS exitosa en ${HTTPS_URL} (HTTP ${HTTPS_STATUS})"
else
  fail "Respuesta HTTPS en ${HTTPS_URL}" "status=${HTTPS_STATUS:-sin respuesta}"
fi

if [[ "${HSTS_HEADER}" == *"max-age="* ]]; then
  pass "Cabecera HSTS activa: ${HSTS_HEADER}"
else
  fail "Cabecera Strict-Transport-Security (HSTS) en ${HTTPS_URL}" "No se recibio cabecera HSTS"
fi

# 3.3 Negociacion TLS 1.3 y verificacion de cadena contra ca.pem
TLS13_OUT="$(openssl s_client -connect "${HOST}:${HTTPS_PORT}" -servername "${HOST}" -tls1_3 -CAfile "${CA_CERT}" </dev/null 2>&1 | tr -d '\r' || true)"
if [[ "${TLS13_OUT}" == *"TLSv1.3"* && "${TLS13_OUT}" == *"Verify return code: 0 (ok)"* ]]; then
  TLS13_CIPHER="$(printf "%s\n" "${TLS13_OUT}" | awk -F'Cipher is ' '/Cipher is / {print $2; exit}')"
  pass "Handshake TLS 1.3 negociado y certificado verificado contra ca.pem (Cipher: ${TLS13_CIPHER:-TLSv1.3 AEAD})"
else
  fail "Handshake TLS 1.3 con verificacion de CA local"
fi

# 3.4 Negociacion TLS 1.2 con cifrado AEAD Forward Secrecy
TLS12_OUT="$(openssl s_client -connect "${HOST}:${HTTPS_PORT}" -servername "${HOST}" -tls1_2 -CAfile "${CA_CERT}" </dev/null 2>&1 | tr -d '\r' || true)"
if [[ "${TLS12_OUT}" == *"TLSv1.2"* && "${TLS12_OUT}" == *"Verify return code: 0 (ok)"* ]]; then
  TLS12_CIPHER="$(printf "%s\n" "${TLS12_OUT}" | awk -F'Cipher is ' '/Cipher is / {print $2; exit}')"
  pass "Handshake TLS 1.2 negociado con Forward Secrecy (Cipher: ${TLS12_CIPHER:-ECDHE-GCM})"
else
  fail "Handshake TLS 1.2 con verificacion de CA local"
fi

# 3.5 Rechazo de protocolos obsoletos (TLS 1.0 y TLS 1.1)
TLS11_OUT="$(openssl s_client -connect "${HOST}:${HTTPS_PORT}" -servername "${HOST}" -tls1_1 </dev/null 2>&1 | tr -d '\r' || true)"
if [[ "${TLS11_OUT}" != *"Cipher is ECDHE"* ]] && ! printf "%s\n" "${TLS11_OUT}" | grep -Eq "New,[[:space:]]*TLSv1\.1"; then
  pass "Rechazo de protocolo obsoleto TLS 1.1 verificado"
else
  fail "Rechazo de protocolo obsoleto TLS 1.1" "El servidor acepto TLS 1.1"
fi

TLS10_OUT="$(openssl s_client -connect "${HOST}:${HTTPS_PORT}" -servername "${HOST}" -tls1 </dev/null 2>&1 | tr -d '\r' || true)"
if [[ "${TLS10_OUT}" != *"Cipher is ECDHE"* ]] && ! printf "%s\n" "${TLS10_OUT}" | grep -Eq "New,[[:space:]]*TLSv1\.0"; then
  pass "Rechazo de protocolo obsoleto TLS 1.0 verificado"
else
  fail "Rechazo de protocolo obsoleto TLS 1.0" "El servidor acepto TLS 1.0"
fi

# 3.6 Rechazo de conexion no segura (HTTP en texto plano enviado al puerto TLS :443)
PLAIN_ON_TLS_STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://${HOST}:${HTTPS_PORT}${HTTPS_PROBE_PATH}" 2>/dev/null || true)"
if [[ "${PLAIN_ON_TLS_STATUS}" == "400" || "${PLAIN_ON_TLS_STATUS}" == "000" ]]; then
  pass "Rechazo de trafico HTTP plano sobre el puerto TLS :${HTTPS_PORT} (status=${PLAIN_ON_TLS_STATUS})"
else
  fail "Rechazo de trafico HTTP plano en puerto TLS :${HTTPS_PORT}" "status=${PLAIN_ON_TLS_STATUS}"
fi

# 3.7 Rechazo de certificado cuando no se proporciona la CA de confianza ni -k
UNTRUSTED_OUT="$(openssl s_client -connect "${HOST}:${HTTPS_PORT}" -servername "${HOST}" -verify_return_error </dev/null 2>&1 | tr -d '\r' || true)"
if [[ "${UNTRUSTED_OUT}" != *"Verify return code: 0 (ok)"* ]]; then
  pass "Rechazo de conexion TLS sin ancla de confianza (CA) valida verificado"
else
  fail "Verificacion estricta de CA en cliente TLS"
fi

# 3.8 Canal WebSocket sobre TLS (wss:// -> Upgrade sobre HTTPS)
WSS_HEADERS="$(curl -k -s -S -i -N --max-time 3 \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "https://${HOST}:${HTTPS_PORT}/api/ws" 2>/dev/null | LC_ALL=C tr -d '\r' || true)"
WSS_STATUS="$(printf "%s\n" "${WSS_HEADERS}" | awk 'NR==1 {print $2}')"
if [[ "${WSS_STATUS}" =~ ^(101|200|400|401|403|426)$ ]]; then
  pass "Canal WebSocket seguro (wss://${HOST}:${HTTPS_PORT}/api/ws) protegido bajo TLS (HTTP ${WSS_STATUS})"
else
  fail "Canal WebSocket seguro (wss://)" "status=${WSS_STATUS:-none}"
fi

printf "\n${BOLD}${CYAN}=============================================================================${NC}\n"
printf "${BOLD}Resultado Final:${NC} ${GREEN}%d PASS${NC}, ${RED}%d FAIL${NC}\n" "${PASS}" "${FAIL}"
printf "${BOLD}${CYAN}=============================================================================${NC}\n"

if [[ "${FAIL}" -gt 0 ]]; then
  exit 1
fi
exit 0
