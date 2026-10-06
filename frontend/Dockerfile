# ==========================================
# Etapa 1: Compilación de la Aplicación Web
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

ENV EXPO_NO_TELEMETRY=1
ENV CI=1

# Instalar dependencias con caché optimizado
COPY package*.json ./
RUN npm ci

# Copiar el código fuente
COPY . .

# Compilar exportación web de producción
RUN npm run build

# ==========================================
# Etapa 2: Servidor Nginx de Producción
# ==========================================
FROM nginx:alpine AS runner

# Copiar configuración personalizada de Nginx para SPA
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copiar los archivos estáticos generados por Expo
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# Salud del contenedor
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
