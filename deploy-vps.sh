#!/usr/bin/env bash
# ==============================================================================
# SCRIPT DE DESPLIEGUE AUTOMÁTICO DE BIBI STORE EN UBUNTU 24.04 (DIGITALOCEAN)
# VPS IP: 64.227.15.171 (1 vCPU, 1 GB RAM - NYC1)
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # Sin color

echo -e "${BLUE}==============================================================${NC}"
echo -e "${GREEN}   INICIANDO INSTALACIÓN Y DESPLIEGUE DE BIBI STORE EN VPS   ${NC}"
echo -e "${BLUE}==============================================================${NC}"

# 1. Asegurar privilegios root
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}Por favor ejecuta este script como root (o usa sudo).${NC}"
  exit 1
fi

# 2. Configuración de memoria Swap (vital para VPS de 1GB de RAM durante compilaciones npm)
if [ ! -f /swapfile ]; then
    echo -e "${YELLOW}[1/7] Creando 1GB de memoria Swap para optimizar la compilación...${NC}"
    fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo -e "${GREEN}✓ Swap de 1GB activado con éxito.${NC}"
else
    echo -e "${GREEN}✓ Swap ya configurado.${NC}"
fi

# 3. Actualizar paquetes del sistema
echo -e "${YELLOW}[2/7] Actualizando repositorios del sistema Ubuntu 24.04...${NC}"
apt-get update -y
apt-get install -y curl git ufw nginx unzip tar

# 4. Configuración del Firewall UFW
echo -e "${YELLOW}[3/7] Configurando cortafuegos (Firewall UFW)...${NC}"
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable || true
echo -e "${GREEN}✓ Puertos 22 (SSH), 80 (HTTP) y 443 (HTTPS) permitidos.${NC}"

# 5. Instalar Node.js 20 LTS
if ! command -v node &> /dev/null || ! node -v | grep -q "v20"; then
    echo -e "${YELLOW}[4/7] Instalando Node.js 20 LTS...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
echo -e "${GREEN}✓ Node.js $(node -v) y NPM $(npm -v) listos.${NC}"

# 6. Directorio de la Aplicación
APP_DIR="/var/www/bibi-store"
echo -e "${YELLOW}[5/7] Configurando directorio de aplicación en $APP_DIR...${NC}"
mkdir -p "$APP_DIR"

# Si el script se ejecuta en una carpeta con el código, copiarlo
if [ -f "package.json" ] && [ "$(pwd)" != "$APP_DIR" ]; then
    echo "Copiando archivos locales hacia $APP_DIR..."
    cp -r ./* "$APP_DIR/"
fi

cd "$APP_DIR"

# 7. Compilación de la aplicación
echo -e "${YELLOW}[6/7] Instalando dependencias de Node.js y compilando Bibi Store...${NC}"
# Usar limitación de memoria para no saturar 1GB RAM
export NODE_OPTIONS="--max-old-space-size=768"
npm install
npm run build

# 8. Configuración de Nginx
echo -e "${YELLOW}[7/7] Configurando servidor web Nginx con soporte SPA y PWA...${NC}"

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

    # Sin caché para el Service Worker y el index.html (para recibir actualizaciones al instante)
    location ~* (sw\.js|registerSW\.js|manifest\.webmanifest|index\.html)$ {
        expires -1;
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
    }

    # Soporte SPA: Redirigir cualquier ruta desconocida a index.html para React Router
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

# Enlazar configuración de Nginx y eliminar la por defecto
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/bibi-store /etc/nginx/sites-enabled/

# Ajustar permisos
chown -R www-data:www-data /var/www/bibi-store/dist
chmod -R 755 /var/www/bibi-store/dist

# Comprobar y recargar Nginx
nginx -t
systemctl restart nginx
systemctl enable nginx

echo -e "${GREEN}==============================================================${NC}"
echo -e "${GREEN}   ¡BIBI STORE ESTÁ PUBLICADO Y ACTIVO EN TU VPS!            ${NC}"
echo -e "${GREEN}==============================================================${NC}"
echo -e "Tu aplicación ya está en línea. Puedes ingresar en tu navegador:"
echo -e "👉 ${BLUE}http://64.227.15.171${NC}"
echo -e ""
echo -e "${YELLOW}PASO OBLIGATORIO PARA AUTENTICACIÓN GOOGLE (FIREBASE):${NC}"
echo -e "1. Abre Firebase Console: https://console.firebase.google.com"
echo -e "2. Selecciona tu proyecto ('gen-lang-client-0621684486')"
echo -e "3. Ve a: Authentication -> Configuración (Settings) -> Dominios autorizados"
echo -e "4. Haz clic en 'Agregar dominio' y coloca: ${GREEN}64.227.15.171${NC}"
echo -e "   (Si compras un dominio .com, agrégalo también allí)."
echo -e "=============================================================="
