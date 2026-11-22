#!/usr/bin/env bash
# =============================================================================
# generate-certs.sh
# =============================================================================
# Generador automatizado de certificados TLS (CA raiz local + certificado de
# servidor X.509v3 con Subject Alternative Names) para el Reverse Proxy de
# GeoPicto (Secure Channel Pattern — Escenario 1, Persona 1).
#
# Archivos generados en nginx/certs/:
#   - ca.pem        Certificado publico de la Autoridad Certificadora (CA) local
#   - ca-key.pem    Clave privada de la CA local (RSA 4096 bits)
#   - cert.pem      Certificado TLS del servidor firmado por la CA local
#   - key.pem       Clave privada del servidor (RSA 2048 bits)
#   - fullchain.pem Cadena completa (cert.pem + ca.pem)
#
# Uso:
#   ./scripts/generate-certs.sh [opciones]
#
# Opciones:
#   --force           Regenera los certificados aunque ya existan y sean validos
#   --mkcert          Usa mkcert (si esta instalado) en lugar de OpenSSL
#   --out-dir <dir>   Directorio de salida (por defecto: nginx/certs)
#   --days <dias>     Vigencia del certificado de servidor (por defecto: 825)
#   --host <dominio>  Agrega un DNS adicional al SAN (repetible)
#   --ip <direccion>  Agrega una IP adicional al SAN (repetible, ej. IP LAN)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

OUT_DIR="${CERTS_DIR:-${REPO_ROOT}/nginx/certs}"
DAYS=825
CA_DAYS=3650
FORCE=false
USE_MKCERT=false
EXTRA_HOSTS=()
EXTRA_IPS=()

# Colores (se desactivan si stdout no es una terminal)
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; NC=''
fi

usage() {
  sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force|-f)
      FORCE=true
      shift
      ;;
    --mkcert)
      USE_MKCERT=true
      shift
      ;;
    --out-dir|-o)
      OUT_DIR="$2"
      shift 2
      ;;
    --days|-d)
      DAYS="$2"
      shift 2
      ;;
    --host)
      EXTRA_HOSTS+=("$2")
      shift 2
      ;;
    --ip)
      EXTRA_IPS+=("$2")
      shift 2
      ;;
    --help|-h)
      usage
      ;;
    *)
      printf "${RED}Error:${NC} Opcion desconocida '%s'. Usa --help para ver las opciones.\n" "$1" >&2
      exit 1
      ;;
  esac
done

mkdir -p "${OUT_DIR}"

CA_KEY="${OUT_DIR}/ca-key.pem"
CA_CERT="${OUT_DIR}/ca.pem"
SERVER_KEY="${OUT_DIR}/key.pem"
SERVER_CSR="${OUT_DIR}/server.csr"
SERVER_CERT="${OUT_DIR}/cert.pem"
FULLCHAIN_CERT="${OUT_DIR}/fullchain.pem"
OPENSSL_CA_CNF="${OUT_DIR}/openssl-ca.cnf"
OPENSSL_SERVER_CNF="${OUT_DIR}/openssl-san.cnf"

printf "${BOLD}${CYAN}=============================================================================${NC}\n"
printf "${BOLD}${CYAN} GeoPicto — Generacion de Certificados TLS (Secure Channel Pattern)${NC}\n"
printf "${BOLD}${CYAN}=============================================================================${NC}\n"
printf "  Directorio destino : %s\n" "${OUT_DIR}"

# -----------------------------------------------------------------------------
# Verificar si los certificados actuales ya existen y siguen vigentes
# -----------------------------------------------------------------------------
if [[ "${FORCE}" == "false" && -f "${SERVER_CERT}" && -f "${SERVER_KEY}" && -f "${CA_CERT}" ]]; then
  if command -v openssl >/dev/null 2>&1 && \
     openssl x509 -checkend 86400 -noout -in "${SERVER_CERT}" >/dev/null 2>&1 && \
     openssl verify -CAfile "${CA_CERT}" "${SERVER_CERT}" >/dev/null 2>&1; then
    printf "  ${GREEN}✓${NC} Certificados TLS validos ya existentes en ${OUT_DIR}.\n"
    printf "    (Usa ${BOLD}--force${NC} si deseas regenerarlos).\n"
    exit 0
  fi
fi

# -----------------------------------------------------------------------------
# Modo opcional: mkcert
# -----------------------------------------------------------------------------
if [[ "${USE_MKCERT}" == "true" ]]; then
  if ! command -v mkcert >/dev/null 2>&1; then
    printf "${RED}Error:${NC} Se solicito --mkcert pero 'mkcert' no esta instalado en el PATH.\n" >&2
    exit 1
  fi

  printf "  Herramienta        : mkcert\n\n"
  mkcert -install >/dev/null 2>&1 || true

  SAN_ARGS=("localhost" "*.localhost" "app.localhost" "profile.localhost" "reverse-proxy" "gateway" "frontend" "profile-web" "host.docker.internal" "127.0.0.1" "::1")
  for h in "${EXTRA_HOSTS[@]+"${EXTRA_HOSTS[@]}"}"; do
    [[ -n "$h" ]] && SAN_ARGS+=("$h")
  done
  for ip in "${EXTRA_IPS[@]+"${EXTRA_IPS[@]}"}"; do
    [[ -n "$ip" ]] && SAN_ARGS+=("$ip")
  done

  mkcert -cert-file "${SERVER_CERT}" -key-file "${SERVER_KEY}" "${SAN_ARGS[@]}"

  CAROOT="$(mkcert -CAROOT)"
  if [[ -f "${CAROOT}/rootCA.pem" ]]; then
    cp "${CAROOT}/rootCA.pem" "${CA_CERT}"
  else
    cp "${SERVER_CERT}" "${CA_CERT}"
  fi
  cat "${SERVER_CERT}" "${CA_CERT}" > "${FULLCHAIN_CERT}"
else
  # ---------------------------------------------------------------------------
  # Modo estandar: OpenSSL (PKI local de 2 niveles: Root CA + Server Leaf Cert)
  # ---------------------------------------------------------------------------
  if ! command -v openssl >/dev/null 2>&1; then
    printf "${RED}Error:${NC} No se encontro 'openssl' en el PATH.\n" >&2
    exit 1
  fi

  printf "  Herramienta        : %s\n" "$(openssl version)"
  printf "  Vigencia servidor  : %s dias (CA: %s dias)\n\n" "${DAYS}" "${CA_DAYS}"

  # 1. Configuracion X.509v3 para la Autoridad Certificadora (CA) local
  cat > "${OPENSSL_CA_CNF}" <<'EOF'
[req]
default_bits       = 4096
prompt             = no
default_md         = sha256
distinguished_name = ca_dn
x509_extensions    = v3_ca

[ca_dn]
C  = CO
ST = Bogota D.C.
L  = Bogota D.C.
O  = GeoPicto Local Development CA
OU = Security Architecture (Team 2F)
CN = GeoPicto Local Root CA

[v3_ca]
subjectKeyIdentifier   = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints       = critical, CA:TRUE, pathlen:0
keyUsage               = critical, digitalSignature, cRLSign, keyCertSign
EOF

  # 2. Configuracion X.509v3 para el certificado del servidor con SANs
  DNS_NAMES=("localhost" "*.localhost" "app.localhost" "profile.localhost" "reverse-proxy" "gateway" "frontend" "profile-web" "host.docker.internal")
  for h in "${EXTRA_HOSTS[@]+"${EXTRA_HOSTS[@]}"}"; do
    [[ -n "$h" ]] && DNS_NAMES+=("$h")
  done

  IP_ADDRS=("127.0.0.1" "::1")
  for ip in "${EXTRA_IPS[@]+"${EXTRA_IPS[@]}"}"; do
    [[ -n "$ip" ]] && IP_ADDRS+=("$ip")
  done

  {
    cat <<'EOF'
[req]
default_bits       = 2048
prompt             = no
default_md         = sha256
distinguished_name = server_dn
req_extensions     = v3_req

[server_dn]
C  = CO
ST = Bogota D.C.
L  = Bogota D.C.
O  = GeoPicto Architecture (Team 2F)
OU = Security Perimeter (Edge TLS)
CN = localhost

[v3_req]
basicConstraints = critical, CA:FALSE
keyUsage         = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectAltName   = @alt_names

[v3_server]
subjectKeyIdentifier   = hash
authorityKeyIdentifier = keyid,issuer:always
basicConstraints       = critical, CA:FALSE
keyUsage               = critical, digitalSignature, keyEncipherment
extendedKeyUsage       = serverAuth, clientAuth
subjectAltName         = @alt_names

[alt_names]
EOF
    idx=1
    for dns in "${DNS_NAMES[@]}"; do
      printf "DNS.%d = %s\n" "${idx}" "${dns}"
      idx=$((idx + 1))
    done
    idx=1
    for ip in "${IP_ADDRS[@]}"; do
      printf "IP.%d = %s\n" "${idx}" "${ip}"
      idx=$((idx + 1))
    done
  } > "${OPENSSL_SERVER_CNF}"

  # 3. Generar Autoridad Certificadora (CA) local si no existe o si se paso --force
  if [[ "${FORCE}" == "true" || ! -f "${CA_CERT}" || ! -f "${CA_KEY}" ]]; then
    printf "  ${CYAN}[1/3]${NC} Generando Autoridad Certificadora (CA) local (${BOLD}ca.pem${NC})...\n"
    openssl genrsa -out "${CA_KEY}" 4096 >/dev/null 2>&1
    openssl req -x509 -new -nodes \
      -key "${CA_KEY}" \
      -sha256 \
      -days "${CA_DAYS}" \
      -out "${CA_CERT}" \
      -config "${OPENSSL_CA_CNF}" \
      -extensions v3_ca >/dev/null 2>&1
  else
    printf "  ${CYAN}[1/3]${NC} Reutilizando CA local existente (${BOLD}ca.pem${NC})...\n"
  fi

  # 4. Generar clave privada y CSR para el Reverse Proxy
  printf "  ${CYAN}[2/3]${NC} Generando clave privada (${BOLD}key.pem${NC}) y CSR del servidor...\n"
  openssl genrsa -out "${SERVER_KEY}" 2048 >/dev/null 2>&1
  openssl req -new \
    -key "${SERVER_KEY}" \
    -out "${SERVER_CSR}" \
    -config "${OPENSSL_SERVER_CNF}" >/dev/null 2>&1

  # 5. Firmar el certificado del servidor con la CA local incluyendo extensiones SAN
  printf "  ${CYAN}[3/3]${NC} Firmando certificado X.509v3 (${BOLD}cert.pem${NC}) con la CA local...\n"
  openssl x509 -req \
    -in "${SERVER_CSR}" \
    -CA "${CA_CERT}" \
    -CAkey "${CA_KEY}" \
    -CAcreateserial \
    -out "${SERVER_CERT}" \
    -days "${DAYS}" \
    -sha256 \
    -extfile "${OPENSSL_SERVER_CNF}" \
    -extensions v3_server >/dev/null 2>&1

  # Construir fullchain.pem (certificado del servidor + CA local)
  cat "${SERVER_CERT}" "${CA_CERT}" > "${FULLCHAIN_CERT}"

  # Limpiar artefactos temporales de firma
  rm -f "${SERVER_CSR}" "${OPENSSL_CA_CNF}" "${OPENSSL_SERVER_CNF}" "${OUT_DIR}/ca.srl"
fi

# Ajustar permisos restrictivos sobre claves privadas
chmod 600 "${SERVER_KEY}" 2>/dev/null || true
[[ -f "${CA_KEY}" ]] && chmod 600 "${CA_KEY}" 2>/dev/null || true
chmod 644 "${SERVER_CERT}" "${CA_CERT}" "${FULLCHAIN_CERT}" 2>/dev/null || true

# -----------------------------------------------------------------------------
# Verificacion criptografica de la cadena generada
# -----------------------------------------------------------------------------
if command -v openssl >/dev/null 2>&1; then
  if ! openssl verify -CAfile "${CA_CERT}" "${SERVER_CERT}" >/dev/null 2>&1; then
    printf "${RED}Error:${NC} La verificacion de la cadena TLS (cert.pem contra ca.pem) fallo.\n" >&2
    exit 1
  fi

  SUBJECT="$(openssl x509 -noout -subject -in "${SERVER_CERT}" | tr -d '\r' | sed 's/^subject=//')"
  ISSUER="$(openssl x509 -noout -issuer -in "${SERVER_CERT}" | tr -d '\r' | sed 's/^issuer=//')"
  DATES="$(openssl x509 -noout -dates -in "${SERVER_CERT}" | tr -d '\r' | tr '\n' ' ')"
  SANS="$(openssl x509 -noout -ext subjectAltName -in "${SERVER_CERT}" | tr -d '\r' | tail -n +2 | sed 's/^[[:space:]]*//')"
  FINGERPRINT="$(openssl x509 -noout -fingerprint -sha256 -in "${SERVER_CERT}" | tr -d '\r' | sed 's/^sha256 Fingerprint=//I')"

  printf "\n${GREEN}✓ Certificados TLS generados y verificados exitosamente:${NC}\n"
  printf "  • CA Local         : %s\n" "${CA_CERT}"
  printf "  • Certificado TLS  : %s\n" "${SERVER_CERT}"
  printf "  • Clave Privada    : %s\n" "${SERVER_KEY}"
  printf "  • Cadena Completa  : %s\n" "${FULLCHAIN_CERT}"
  printf "  • Subject          : %s\n" "${SUBJECT}"
  printf "  • Issuer           : %s\n" "${ISSUER}"
  printf "  • SANs             : %s\n" "${SANS}"
  printf "  • Vigencia         : %s\n" "${DATES}"
  printf "  • SHA-256          : %s\n" "${FINGERPRINT}"
fi
