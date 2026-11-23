#!/bin/sh
# Elige el certificado que usara Nginx (ver conf.d/ssl.conf) antes de arrancar.
# La imagen oficial de Nginx ejecuta los scripts de /docker-entrypoint.d/.
#
#   1. Si Persona 1 genero nginx/certs/cert.pem y nginx/certs/key.pem (montados
#      de solo lectura en /etc/nginx/certs), se usan esos (incluyendo ca.pem si
#      existe).
#   2. Si no, se usa el certificado autofirmado TEMPORAL creado al construir
#      la imagen (ver Dockerfile). El navegador mostrara una advertencia.
set -eu

PROVIDED_DIR=/etc/nginx/certs
TEMP_DIR=/etc/nginx/tls-temp
ACTIVE_DIR=/etc/nginx/tls

mkdir -p "$ACTIVE_DIR"

if [ -s "$PROVIDED_DIR/cert.pem" ] && [ -s "$PROVIDED_DIR/key.pem" ]; then
    if [ -s "$PROVIDED_DIR/fullchain.pem" ]; then
        cp "$PROVIDED_DIR/fullchain.pem" "$ACTIVE_DIR/cert.pem"
    else
        cp "$PROVIDED_DIR/cert.pem" "$ACTIVE_DIR/cert.pem"
    fi
    cp "$PROVIDED_DIR/key.pem" "$ACTIVE_DIR/key.pem"
    if [ -s "$PROVIDED_DIR/ca.pem" ]; then
        cp "$PROVIDED_DIR/ca.pem" "$ACTIVE_DIR/ca.pem"
    fi
    echo "40-tls-certs: usando certificados de $PROVIDED_DIR"
else
    cp "$TEMP_DIR/cert.pem" "$ACTIVE_DIR/cert.pem"
    cp "$TEMP_DIR/key.pem" "$ACTIVE_DIR/key.pem"
    echo "40-tls-certs: TEMPORAL - no hay certificados en $PROVIDED_DIR, usando autofirmado"
fi

chmod 600 "$ACTIVE_DIR/key.pem"
