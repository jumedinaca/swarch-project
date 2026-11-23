# Reverse Proxy perimetral de GeoPicto (Escenario de seguridad 2).
FROM nginx:1.27-alpine

# openssl solo se usa para crear el certificado autofirmado TEMPORAL.
RUN apk add --no-cache openssl

# TEMPORAL (hasta integrar los certificados de Persona 1): certificado
# autofirmado para los nombres que sirve el proxy. Se crea al construir la
# imagen para que no cambie en cada reinicio del contenedor.
RUN mkdir -p /etc/nginx/tls-temp \
    && openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
        -subj "/CN=localhost/O=GeoPicto (TEMPORAL)" \
        -addext "subjectAltName=DNS:localhost,DNS:app.localhost,DNS:profile.localhost,IP:127.0.0.1,IP:::1" \
        -keyout /etc/nginx/tls-temp/key.pem \
        -out /etc/nginx/tls-temp/cert.pem \
    && chmod 600 /etc/nginx/tls-temp/key.pem

# Se reemplaza la configuracion por defecto de la imagen.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d/ /etc/nginx/conf.d/
COPY snippets/ /etc/nginx/snippets/
COPY sites/ /etc/nginx/sites/
COPY --chmod=755 docker-entrypoint.d/40-tls-certs.sh /docker-entrypoint.d/40-tls-certs.sh

EXPOSE 80 443

# 127.0.0.1 y no localhost: en Alpine localhost puede resolver a ::1.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz > /dev/null || exit 1
