#!/usr/bin/env bash
# ==============================================================================
# INSTALADOR AUTOMÁTICO EN 1 CLIC PARA BIBI STORE EN DIGITALOCEAN
# VPS: ubuntu-s-1vcpu-1gb-nyc1 (IP: 64.227.15.171)
# ==============================================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}==============================================================${NC}"
echo -e "${GREEN}     INSTALANDO BIBI STORE EN TU VPS DE DIGITALOCEAN         ${NC}"
echo -e "${BLUE}==============================================================${NC}"

# Verificar que sea root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Por favor ejecuta este script como root (o usa sudo).${NC}"
  exit 1
fi

BASE_URL="https://ais-pre-gblqqchksfkcg6b6rsqrxx-48346512190.us-east1.run.app"
FALLBACK_URL="https://ais-dev-gblqqchksfkcg6b6rsqrxx-48346512190.us-east1.run.app"

# 1. Actualizar repositorios e instalar Nginx y herramientas
echo -e "${YELLOW}[1/5] Instalando Nginx, Firewall y herramientas básicas...${NC}"
apt-get update -y
apt-get install -y curl ufw nginx tar

# 2. Configurar Firewall
echo -e "${YELLOW}[2/5] Configurando Firewall UFW...${NC}"
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable || true

# 3. Preparar directorios
echo -e "${YELLOW}[3/5] Descargando aplicación pre-compilada Bibi Store...${NC}"
mkdir -p /var/www/bibi-store/dist
mkdir -p /var/www/bibi-store/source

# Descargar bundle de producción
if curl -fsSL "${BASE_URL}/bibi-store-dist.tar.gz" -o /tmp/bibi-store-dist.tar.gz; then
  echo "✓ Paquete de producción descargado con éxito."
elif curl -fsSL "${FALLBACK_URL}/bibi-store-dist.tar.gz" -o /tmp/bibi-store-dist.tar.gz; then
  echo "✓ Paquete de producción descargado desde servidor secundario."
else
  echo -e "${RED}Error al descargar paquete de producción.${NC}"
  exit 1
fi

tar -xzf /tmp/bibi-store-dist.tar.gz -C /var/www/bibi-store/dist

# Descargar código fuente (opcional para desarrollo futuro)
curl -fsSL "${BASE_URL}/bibi-store-source.tar.gz" -o /tmp/bibi-store-source.tar.gz || true
if [ -f /tmp/bibi-store-source.tar.gz ]; then
  tar -xzf /tmp/bibi-store-source.tar.gz -C /var/www/bibi-store/source || true
fi

# 4. Configurar Nginx para SPA (React Router y PWA)
echo -e "${YELLOW}[4/5] Configurando servidor web Nginx con soporte SPA...${NC}"

cat << 'EOF' > /etc/nginx/sites-available/bibi-store
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name 64.227.15.171 _;

    root /var/www/bibi-store/dist;
    index index.html;

    # Compresión Gzip para máxima velocidad
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml application/atom+xml image/svg+xml;

    # Cabeceras de seguridad
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;

    # Caching para recursos estáticos pesados (JS, CSS, imágenes)
    location ~* \.(?:ico|css|js|gif|jpe?g|png|woff2?|eot|otf|ttf|svg)$ {
        expires 30d;
        access_log off;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    # Sin caché para el Service Worker y el index.html
    location ~* (sw\.js|registerSW\.js|manifest\.webmanifest|index\.html)$ {
        expires -1;
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
    }

    client_max_body_size 100M;

    # Proxy hacia el Backend Autónomo de la VPS
    location /api/ {
        proxy_pass http://127.0.0.1:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
    }

    # Soporte SPA: Redirigir cualquier ruta a index.html para React Router
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

# Configurar Backend Autónomo Node.js
mkdir -p /var/www/bibi-store/data
mkdir -p /var/www/bibi-store/server
if [ -f /var/www/bibi-store/source/server/vps_server.cjs ]; then
  cp /var/www/bibi-store/source/server/vps_server.cjs /var/www/bibi-store/server/vps_server.cjs
fi

cat << 'EOF' > /etc/systemd/system/bibi-backend.service
[Unit]
Description=Bibi Store VPS Backend Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/bibi-store
ExecStart=/usr/bin/node /var/www/bibi-store/server/vps_server.cjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=5000

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now bibi-backend || true
systemctl restart bibi-backend || true

# Habilitar sitio
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/bibi-store /etc/nginx/sites-enabled/

# Permisos
chown -R www-data:www-data /var/www/bibi-store
chmod -R 755 /var/www/bibi-store/dist

# Probar y reiniciar Nginx
echo -e "${YELLOW}[5/5] Iniciando Nginx...${NC}"
nginx -t
systemctl restart nginx
systemctl enable nginx

echo -e "${GREEN}==============================================================${NC}"
echo -e "${GREEN}   ¡BIBI STORE SE HA INSTALADO Y ESTÁ ACTIVO EN TU VPS!      ${NC}"
echo -e "${GREEN}==============================================================${NC}"
echo -e ""
echo -e "Ya puedes abrir Bibi Store en tu navegador ingresando a:"
echo -e "👉 ${BLUE}http://64.227.15.171${NC}"
echo -e ""
echo -e "${YELLOW}PASO FINAL EN FIREBASE (Para que funcione el login con Google):${NC}"
echo -e "1. Entra a: https://console.firebase.google.com"
echo -e "2. Selecciona tu proyecto: gen-lang-client-0621684486"
echo -e "3. Ve a: Authentication -> Settings (Configuración) -> Dominios autorizados"
echo -e "4. Agrega: 64.227.15.171"
echo -e "=============================================================="
