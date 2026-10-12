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

# Expo incrusta las variables EXPO_PUBLIC_* en el bundle al compilar
ARG EXPO_PUBLIC_API_GATEWAY_URL=http://localhost:8080
ARG EXPO_PUBLIC_USE_MOCK_DATA=true
ENV EXPO_PUBLIC_API_GATEWAY_URL=$EXPO_PUBLIC_API_GATEWAY_URL
ENV EXPO_PUBLIC_USE_MOCK_DATA=$EXPO_PUBLIC_USE_MOCK_DATA

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
