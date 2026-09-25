#!/usr/bin/env bash
# ==============================================================================
# ACTIVADOR DE HTTPS / SSL PARA BIBI STORE EN VPS DIGITALOCEAN
# Droplet IP: 143.198.163.70 (Ubuntu 24.04 LTS)
# ==============================================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}   ACTIVANDO SSL / HTTPS PARA DROPLET 143.198.163.70           ${NC}"
echo -e "${BLUE}================================================================${NC}"

if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}Por favor ejecuta como root: sudo bash activar-ssl-https.sh${NC}"
  exit 1
fi

# 1. Crear directorios para certificados SSL
echo -e "${YELLOW}[1/4] Generando certificado SSL seguro para la IP 143.198.163.70...${NC}"
mkdir -p /etc/ssl/private /etc/ssl/certs

# Generar certificado auto-firmado de 2048 bits válido por 2 años
openssl req -x509 -nodes -days 730 -newkey rsa:2048 \
  -keyout /etc/ssl/private/bibi-store.key \
  -out /etc/ssl/certs/bibi-store.crt \
  -subj "/C=VE/ST=Miranda/L=Caracas/O=BibiStore/OU=POS/CN=143.198.163.70"

chmod 600 /etc/ssl/private/bibi-store.key
chmod 644 /etc/ssl/certs/bibi-store.crt
echo -e "${GREEN}✓ Certificado SSL generado con éxito.${NC}"

# 2. Configurar Nginx con soporte HTTP (80) y HTTPS (443)
echo -e "${YELLOW}[2/4] Configurando Nginx con soporte HTTPS (puerto 443)...${NC}"

cat << 'EOF' > /etc/nginx/sites-available/bibi-store
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;

    server_name 143.198.163.70 localhost _;

    # Certificados SSL
    ssl_certificate /etc/ssl/certs/bibi-store.crt;
    ssl_certificate_key /etc/ssl/private/bibi-store.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    root /var/www/bibi-store/dist;
    index index.html;

    client_max_body_size 100M;
    client_body_buffer_size 128k;

    # Compresión
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml application/atom+xml image/svg+xml;

    # Cabeceras de seguridad
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Fotos desacopladas servidas directamente desde disco
    location /uploads/ {
        alias /var/www/bibi-store/public/uploads/;
        expires 30d;
        access_log off;
        add_header Cache-Control "public, max-age=2592000, immutable";
        try_files $uri =404;
    }

    # Proxy inverso al backend Node.js en puerto 5000
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 180s;
        proxy_connect_timeout 180s;
    }

    # SPA Fallback (React Router)
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

# 3. Habilitar puerto 443 en el firewall UFW
echo -e "${YELLOW}[3/4] Permitiendo tráfico HTTPS en firewall...${NC}"
ufw allow 443/tcp || true
ufw allow 'Nginx Full' || true

# 4. Probar y reiniciar Nginx
echo -e "${YELLOW}[4/4] Verificando sintaxis de Nginx y reiniciando servicio...${NC}"
nginx -t
systemctl restart nginx

echo -e ""
echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}   ¡HTTPS / SSL ACTIVADO EXITOSAMENTE EN TU VPS!                ${NC}"
echo -e "${BLUE}================================================================${NC}"
echo -e "Ahora puedes ingresar tanto por HTTP como por HTTPS seguro:"
echo -e "👉 ${BLUE}https://143.198.163.70${NC} (Recomendado para cámara continua)"
echo -e "👉 ${BLUE}http://143.198.163.70${NC}"
echo -e ""
echo -e "${YELLOW}NOTA IMPORTANTE PARA TU CELULAR:${NC}"
echo -e "Al entrar a https://143.198.163.70 por primera vez, tu navegador mostrará un aviso de advertencia."
echo -e "Simplemente toca en ${GREEN}'Configuración avanzada'${NC} -> ${GREEN}'Continuar a 143.198.163.70 (no seguro)'${NC}."
echo -e "¡Desde ese momento la cámara continua funcionará al 100% de forma nativa!"
echo -e "${BLUE}================================================================${NC}"
