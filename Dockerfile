# Multi-stage Dockerfile para Bibi Store
# Etapa 1: Compilación con Node 20
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Etapa 2: Servidor web ultraligero Nginx
FROM nginx:alpine

# Copiar configuración optimizada de Nginx para SPA
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copiar artefactos estáticos compilados
COPY --from=builder /app/dist /var/www/bibi-store/dist

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
