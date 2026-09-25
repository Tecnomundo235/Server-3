#!/usr/bin/env bash
# ==============================================================================
# SCRIPT DE VINCULACIÓN DIRECTA CON GITHUB PARA DROPLET DIGITALOCEAN
# IP: 143.198.163.70 (ubuntu-s-1vcpu-1gb-nyc1)
# Repositorio: https://github.com/monetizacionreymonfr2-max/Bibi-Store
# ==============================================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}    VINCULACIÓN Y SINCRONIZACIÓN DESDE GITHUB (143.198.163.70)   ${NC}"
echo -e "${BLUE}================================================================${NC}"

APP_DIR="/var/www/bibi-store"
REPO_URL="https://github.com/monetizacionreymonfr2-max/Bibi-Store.git"

# 1. Asegurar Memoria Swap (Crítico para que npm install y vite build no se queden sin RAM)
echo -e "${YELLOW}[1/8] Verificando memoria Swap (1GB RAM droplet)...${NC}"
if [ $(swapon --show | wc -l) -le 1 ]; then
    echo "Configurando 1GB de Swap para evitar que falle la compilación..."
    fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab || true
    echo "✓ Swap configurado exitosamente."
else
    echo "✓ Memoria Swap ya activa."
fi

# 2. Respaldar base de datos y uploads si ya existen
echo -e "${YELLOW}[2/8] Respaldando datos locales y uploads existentes...${NC}"
mkdir -p /tmp/bibi_store_backup
if [ -d "$APP_DIR/data" ]; then
    cp -r "$APP_DIR/data" /tmp/bibi_store_backup/
fi
if [ -d "$APP_DIR/public/uploads" ]; then
    cp -r "$APP_DIR/public/uploads" /tmp/bibi_store_backup/
fi

# 3. Clonar o Actualizar el repositorio de GitHub
echo -e "${YELLOW}[3/8] Sincronizando con el repositorio GitHub...${NC}"
mkdir -p "$APP_DIR"
cd "$APP_DIR"

if [ -d "$APP_DIR/.git" ]; then
    echo "Actualizando repositorio existente con git fetch & pull..."
    git remote set-url origin "$REPO_URL" || true
    git fetch origin main
    git reset --hard origin/main
else
    echo "Clonando repositorio limpio desde $REPO_URL..."
    cd /var/www
    rm -rf /var/www/bibi-store-tmp
    git clone "$REPO_URL" bibi-store-tmp
    
    # Detener backend antes de mover
    systemctl stop bibi-backend || true

    rm -rf "$APP_DIR"
    mv bibi-store-tmp "$APP_DIR"
    cd "$APP_DIR"
fi

# Restaurar datos y uploads locales
if [ -d "/tmp/bibi_store_backup/data" ]; then
    cp -r /tmp/bibi_store_backup/data "$APP_DIR/"
fi
if [ -d "/tmp/bibi_store_backup/uploads" ]; then
    mkdir -p "$APP_DIR/public/uploads"
    cp -r /tmp/bibi_store_backup/uploads/* "$APP_DIR/public/uploads/" 2>/dev/null || true
fi
rm -rf /tmp/bibi_store_backup

mkdir -p "$APP_DIR/data"
mkdir -p "$APP_DIR/public/uploads/productos"

# 4. Instalar dependencias con límite de memoria optimizado
echo -e "${YELLOW}[4/8] Instalando dependencias de Node.js...${NC}"
export NODE_OPTIONS="--max-old-space-size=768"
npm install --no-audit --no-fund

# 5. Compilar el Frontend (Vite)
echo -e "${YELLOW}[5/8] Compilando el frontend (Vite + React)...${NC}"
npm run build

# 6. Configurar el Servicio Backend Autónomo (Systemd)
echo -e "${YELLOW}[6/8] Configurando servicio Systemd bibi-backend...${NC}"
cat << 'EOF' > /etc/systemd/system/bibi-backend.service
[Unit]
Description=Bibi Store POS Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/bibi-store
ExecStart=/usr/bin/node /var/www/bibi-store/server/vps_server.cjs
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=5000

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now bibi-backend
systemctl restart bibi-backend

# 7. Configurar Nginx para 143.198.163.70
echo -e "${YELLOW}[7/8] Configurando servidor web Nginx para 143.198.163.70...${NC}"
cat << 'EOF' > /etc/nginx/sites-available/bibi-store
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name 143.198.163.70 _;

    root /var/www/bibi-store/dist;
    index index.html;

    client_max_body_size 100M;
    client_body_buffer_size 128k;

    # Fotos desacopladas servidas directamente desde disco
    location /uploads/ {
        alias /var/www/bibi-store/public/uploads/;
        expires 30d;
        access_log off;
        add_header Cache-Control "public, max-age=2592000, immutable";
        try_files $uri =404;
    }

    # Proxy inverso al backend local
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 180s;
        proxy_connect_timeout 180s;
    }

    # SPA Fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/*
ln -sf /etc/nginx/sites-available/bibi-store /etc/nginx/sites-enabled/bibi-store
nginx -t && systemctl restart nginx

# 8. Permisos
echo -e "${YELLOW}[8/8] Ajustando permisos de archivos...${NC}"
chown -R www-data:www-data /var/www/bibi-store
chmod -R 755 /var/www/bibi-store

echo -e ""
echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}  ✓ ¡VPS VINCULADA Y SINCRONIZADA CON GITHUB EXITOSAMENTE!       ${NC}"
echo -e "${BLUE}================================================================${NC}"
echo -e "✓ Repositorio:    https://github.com/monetizacionreymonfr2-max/Bibi-Store"
echo -e "✓ Último Commit:  $(cd $APP_DIR && git log -1 --oneline 2>/dev/null || echo 'Sincronizado')"
echo -e "✓ Backend VPS:    $(systemctl is-active bibi-backend)"
echo -e "✓ Nginx:          $(systemctl is-active nginx)"
echo -e "✓ IP del Droplet: 143.198.163.70"
echo -e ""
echo -e "Accede a la aplicación en tu navegador:"
echo -e "👉 ${BLUE}http://143.198.163.70${NC}"
echo -e "👉 ${BLUE}http://143.198.163.70/ajustes${NC}"
echo -e "${BLUE}================================================================${NC}"
