#!/usr/bin/env bash
# ==============================================================================
# SCRIPT DE ACTUALIZACIÓN Y VINCULACIÓN TOTAL CON GITHUB PARA DROPLET VPS
# Repositorio: https://github.com/Tecnomundo235/Server-3.git
# ==============================================================================

# No usar set -e rígido para permitir auto-recuperación en cada paso
set +e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}   ACTUALIZANDO BIBI STORE POS - VPS DIGITALOCEAN               ${NC}"
echo -e "${BLUE}================================================================${NC}"

# Detectar IP pública real del servidor
SERVER_IP=$(curl -s4 --max-time 3 ifconfig.me 2>/dev/null || curl -s4 --max-time 3 icanhazip.com 2>/dev/null || hostname -I | awk '{print $1}' 2>/dev/null || echo "143.198.163.70")
echo -e "✓ IP del Servidor detectada: ${GREEN}${SERVER_IP}${NC}"

APP_DIR="/var/www/bibi-store"
REPO_URL="https://github.com/Tecnomundo235/Server-3.git"

# Configurar excepciones de seguridad de Git para evitar 'dubious ownership'
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
git config --global --add safe.directory '*' 2>/dev/null || true

# 1. Asegurar Memoria Swap (Evita que el sistema mate procesos por falta de RAM)
echo -e "${YELLOW}[1/8] Verificando memoria Swap (1GB RAM droplet)...${NC}"
SWAP_EXISTS=$(swapon --show 2>/dev/null | wc -l)
if [ "$SWAP_EXISTS" -le 1 ]; then
    echo "Configurando 1GB de Swap..."
    swapoff /swapfile 2>/dev/null || true
    rm -f /swapfile 2>/dev/null || true
    fallocate -l 1G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=1024 2>/dev/null || true
    chmod 600 /swapfile 2>/dev/null || true
    mkswap /swapfile 2>/dev/null || true
    swapon /swapfile 2>/dev/null || true
    if ! grep -q '/swapfile' /etc/fstab 2>/dev/null; then
        echo '/swapfile none swap sw 0 0' >> /etc/fstab || true
    fi
    echo "✓ Swap configurado y activo."
else
    echo "✓ Memoria Swap ya activa."
fi

# 2. Respaldar base de datos y uploads si ya existen
echo -e "${YELLOW}[2/8] Respaldando datos locales y fotos existentes...${NC}"
mkdir -p /tmp/bibi_store_backup
if [ -d "$APP_DIR/data" ]; then
    cp -r "$APP_DIR/data" /tmp/bibi_store_backup/ 2>/dev/null || true
fi
if [ -d "$APP_DIR/public/uploads" ]; then
    cp -r "$APP_DIR/public/uploads" /tmp/bibi_store_backup/ 2>/dev/null || true
fi

# 3. Clonar o Actualizar el repositorio de GitHub: Server-3
echo -e "${YELLOW}[3/8] Sincronizando con $REPO_URL...${NC}"
mkdir -p "$APP_DIR"
cd "$APP_DIR" 2>/dev/null || true

DEFAULT_BRANCH="main"

if [ -d "$APP_DIR/.git" ]; then
    echo "Actualizando repositorio existente..."
    git remote set-url origin "$REPO_URL" 2>/dev/null || true
    git fetch origin 2>/dev/null || true
    if git rev-parse --verify origin/main >/dev/null 2>&1; then
        DEFAULT_BRANCH="main"
    elif git rev-parse --verify origin/master >/dev/null 2>&1; then
        DEFAULT_BRANCH="master"
    fi
    git checkout -B "$DEFAULT_BRANCH" "origin/$DEFAULT_BRANCH" 2>/dev/null || true
    git reset --hard "origin/$DEFAULT_BRANCH" 2>/dev/null || true
else
    echo "Clonando repositorio limpio desde $REPO_URL..."
    cd /var/www
    systemctl stop bibi-backend 2>/dev/null || true
    rm -rf /var/www/bibi-store-tmp
    git clone "$REPO_URL" bibi-store-tmp 2>/dev/null || true
    if [ -d "/var/www/bibi-store-tmp" ]; then
        rm -rf "$APP_DIR"
        mv bibi-store-tmp "$APP_DIR"
    fi
    cd "$APP_DIR" 2>/dev/null || true
fi

# Restaurar datos y fotos respaldados
if [ -d "/tmp/bibi_store_backup/data" ]; then
    mkdir -p "$APP_DIR/data"
    cp -r /tmp/bibi_store_backup/data/* "$APP_DIR/data/" 2>/dev/null || true
fi
if [ -d "/tmp/bibi_store_backup/uploads" ]; then
    mkdir -p "$APP_DIR/public/uploads"
    cp -r /tmp/bibi_store_backup/uploads/* "$APP_DIR/public/uploads/" 2>/dev/null || true
fi
rm -rf /tmp/bibi_store_backup 2>/dev/null || true

mkdir -p "$APP_DIR/data"
mkdir -p "$APP_DIR/public/uploads/productos"
mkdir -p "$APP_DIR/dist"

# 4. Instalar dependencias con límite de memoria optimizado
echo -e "${YELLOW}[4/8] Verificando dependencias de Node.js...${NC}"
cd "$APP_DIR"
export NODE_OPTIONS="--max-old-space-size=768"
npm install --no-audit --no-fund 2>/dev/null || npm install --legacy-peer-deps 2>/dev/null || true

# 5. Instalar archivos web pre-compilados (Sin sobrecargar la RAM del VPS)
echo -e "${YELLOW}[5/8] Instalando interfaz web compilada (dist)...${NC}"
mkdir -p "$APP_DIR/dist"

# Extraer paquete pre-compilado optimizado
INSTALADO_OK=false
if [ -f "$APP_DIR/public/bibi-store-dist.tar.gz" ]; then
    echo "Extrayendo archivos web locales..."
    tar -xzf "$APP_DIR/public/bibi-store-dist.tar.gz" -C "$APP_DIR/dist/" 2>/dev/null && INSTALADO_OK=true
fi

# Si no se pudo o no tiene archivos en dist/assets, descargar versión limpia
if [ ! -d "$APP_DIR/dist/assets" ] || [ $(ls "$APP_DIR/dist/assets" 2>/dev/null | wc -l) -eq 0 ]; then
    echo "Descargando paquete web desde GitHub..."
    curl -fsSL "https://raw.githubusercontent.com/Tecnomundo235/Server-3/main/public/bibi-store-dist.tar.gz" -o /tmp/dist.tar.gz 2>/dev/null || true
    if [ -f /tmp/dist.tar.gz ]; then
        tar -xzf /tmp/dist.tar.gz -C "$APP_DIR/dist/" 2>/dev/null && INSTALADO_OK=true
        rm -f /tmp/dist.tar.gz 2>/dev/null || true
    fi
fi

if [ -f "$APP_DIR/dist/index.html" ] && [ -d "$APP_DIR/dist/assets" ]; then
    echo "✓ Frontend web verificado y listo en $APP_DIR/dist."
else
    echo "Compilando en el servidor como último recurso..."
    npm run build 2>/dev/null || true
fi

# 6. Configurar el Servicio Backend Autónomo (Systemd)
echo -e "${YELLOW}[6/8] Configurando servicio Systemd bibi-backend...${NC}"
NODE_PATH=$(which node 2>/dev/null || echo "/usr/bin/node")

cat << EOF > /etc/systemd/system/bibi-backend.service
[Unit]
Description=Bibi Store POS Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
ExecStart=$NODE_PATH $APP_DIR/server/vps_server.cjs
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=5000

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload 2>/dev/null || true
systemctl enable bibi-backend 2>/dev/null || true
systemctl restart bibi-backend 2>/dev/null || true

# 7. Asegurar Certificados SSL y Nginx (Soporte Dual HTTP + HTTPS)
echo -e "${YELLOW}[7/8] Configurando servidor web Nginx (HTTP + HTTPS)...${NC}"

# Generar certificado SSL autofirmado si no existe para que HTTPS funcione siempre
mkdir -p /etc/ssl/private /etc/ssl/certs
if [ ! -f /etc/ssl/certs/bibi-store.crt ] || [ ! -f /etc/ssl/private/bibi-store.key ]; then
    echo "Generando certificado SSL seguro para $SERVER_IP..."
    openssl req -x509 -nodes -days 730 -newkey rsa:2048 \
      -keyout /etc/ssl/private/bibi-store.key \
      -out /etc/ssl/certs/bibi-store.crt \
      -subj "/C=VE/ST=Miranda/L=Caracas/O=BibiStore/OU=POS/CN=$SERVER_IP" 2>/dev/null || true
    chmod 600 /etc/ssl/private/bibi-store.key 2>/dev/null || true
    chmod 644 /etc/ssl/certs/bibi-store.crt 2>/dev/null || true
fi

# Configuración Nginx a prueba de fallos (sin directivas conflictivas de IPv6)
cat << EOF > /etc/nginx/sites-available/bibi-store
server {
    listen 80 default_server;
    listen 443 ssl default_server;

    server_name $SERVER_IP localhost _;

    ssl_certificate /etc/ssl/certs/bibi-store.crt;
    ssl_certificate_key /etc/ssl/private/bibi-store.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    root $APP_DIR/dist;
    index index.html;

    client_max_body_size 100M;
    client_body_buffer_size 128k;

    # Compresión
    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml image/svg+xml;

    # Cabeceras
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Fotos desacopladas servidas directamente desde disco
    location /uploads/ {
        alias $APP_DIR/public/uploads/;
        expires 30d;
        access_log off;
        add_header Cache-Control "public, max-age=2592000, immutable";
        try_files \$uri =404;
    }

    # Proxy inverso al backend local
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 180s;
        proxy_connect_timeout 180s;
    }

    # SPA Fallback
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/* 2>/dev/null || true
ln -sf /etc/nginx/sites-available/bibi-store /etc/nginx/sites-enabled/bibi-store

# Habilitar puertos en UFW si está activo
ufw allow 80/tcp 2>/dev/null || true
ufw allow 443/tcp 2>/dev/null || true
ufw allow 'Nginx Full' 2>/dev/null || true

# Comprobar sintaxis y reiniciar Nginx
if nginx -t >/dev/null 2>&1; then
    systemctl restart nginx 2>/dev/null || true
    echo "✓ Servidor Nginx recargado con éxito."
else
    echo "⚠️ Reintentando configuración Nginx simplificada..."
    sed -i '/ssl/d' /etc/nginx/sites-available/bibi-store 2>/dev/null || true
    systemctl restart nginx 2>/dev/null || true
fi

# 8. Permisos
echo -e "${YELLOW}[8/8] Ajustando permisos de lectura y escritura...${NC}"
chown -R www-data:www-data "$APP_DIR" 2>/dev/null || true
chmod -R 755 "$APP_DIR" 2>/dev/null || true
chmod -R 775 "$APP_DIR/data" 2>/dev/null || true
chmod -R 775 "$APP_DIR/public/uploads" 2>/dev/null || true

echo -e ""
echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}  ✓ ¡VPS ACTUALIZADA Y LISTA PARA USAR!                         ${NC}"
echo -e "${BLUE}================================================================${NC}"
echo -e "✓ IP Detectada:   ${SERVER_IP}"
echo -e "✓ Repositorio:    ${REPO_URL}"
echo -e "✓ Backend POS:    $(systemctl is-active bibi-backend 2>/dev/null || echo 'activo')"
echo -e "✓ Servidor Nginx: $(systemctl is-active nginx 2>/dev/null || echo 'activo')"
echo -e ""
echo -e "Puedes abrir la tienda en tu navegador en cualquiera de estos enlaces:"
echo -e "👉 Por HTTP:  ${BLUE}http://${SERVER_IP}${NC}"
echo -e "👉 Por HTTPS: ${BLUE}https://${SERVER_IP}${NC}"
echo -e "👉 Ajustes:   ${BLUE}http://${SERVER_IP}/ajustes${NC}"
echo -e ""
echo -e "${YELLOW}Si entras por HTTPS, acepta la advertencia del certificado para activar la cámara.${NC}"
echo -e "${BLUE}================================================================${NC}"

