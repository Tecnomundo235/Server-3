#!/usr/bin/env bash
# ==============================================================================
# ACTIVADOR DEL BACKEND AUTÓNOMO DE BIBI STORE EN LA VPS (PORT 5000 + NGINX)
# ==============================================================================
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Por favor ejecuta este script como root (o usa sudo)."
  exit 1
fi

echo "=========================================================="
echo "   ACTIVANDO SERVIDOR BACKEND AUTÓNOMO EN TU VPS         "
echo "=========================================================="

mkdir -p /var/www/bibi-store/data
mkdir -p /var/www/bibi-store/server

# Instalar dependencias necesarias si faltan
cd /var/www/bibi-store
if [ ! -d "node_modules/express" ]; then
  echo "Instalando Express para el backend..."
  npm install express
fi

# Crear el servicio de systemd para el backend
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

# Recargar y arrancar servicio
systemctl daemon-reload
systemctl enable --now bibi-backend
systemctl restart bibi-backend

# Configurar Nginx con el proxy /api/
cat << 'EOF' > /etc/nginx/sites-available/bibi-store
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name 64.227.15.171 _;

    root /var/www/bibi-store/dist;
    index index.html;

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

    # SPA Fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

nginx -t
systemctl restart nginx

echo "=========================================================="
echo "✓ ¡BACKEND AUTÓNOMO ACTIVO Y FUNCIONANDO EN TU VPS!"
echo "✓ Estado del backend: $(systemctl is-active bibi-backend)"
echo "✓ Tu Bibi Store ahora es 100% independiente de Firebase."
echo "=========================================================="
