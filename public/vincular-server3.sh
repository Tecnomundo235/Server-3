#!/usr/bin/env bash
# ==============================================================================
# SCRIPT UNIFICADO: VINCULACIÓN DEFINITIVA A TECNOMUNDO235/SERVER-3
# ==============================================================================
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}    VINCULANDO DEFINITIVAMENTE A Tecnomundo235/Server-3         ${NC}"
echo -e "${BLUE}================================================================${NC}"

APP_DIR="/var/www/bibi-store"
REPO_URL="https://github.com/Tecnomundo235/Server-3.git"

# 1. Configurar safe.directory globalmente
git config --global --add safe.directory "$APP_DIR" || true

# 2. Respaldar base de datos y fotos existentes
mkdir -p /tmp/bibi_store_backup
if [ -d "$APP_DIR/data" ]; then
    cp -r "$APP_DIR/data" /tmp/bibi_store_backup/
fi
if [ -d "$APP_DIR/public/uploads" ]; then
    cp -r "$APP_DIR/public/uploads" /tmp/bibi_store_backup/
fi

# 3. Detener backend temporalmente
systemctl stop bibi-backend || true

# 4. Clonar limpio en carpeta temporal y reemplazar
echo -e "${YELLOW}Clonando repositorio Server-3...${NC}"
cd /var/www
rm -rf /var/www/bibi-store-tmp
git clone "$REPO_URL" /var/www/bibi-store-tmp

# Mover repositorio nuevo
rm -rf "$APP_DIR"
mv /var/www/bibi-store-tmp "$APP_DIR"
cd "$APP_DIR"

# 5. Restaurar datos y fotos
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

# 6. Instalar y Compilar con límite de RAM optimizado
echo -e "${YELLOW}Compilando Frontend y dependencias...${NC}"
export NODE_OPTIONS="--max-old-space-size=768"
npm install --no-audit --no-fund || npm install --legacy-peer-deps || true
npm run build

# 7. Permisos correctos
chown -R www-data:www-data "$APP_DIR"
chmod -R 755 "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" || true

# 8. Reiniciar servicios
systemctl daemon-reload
systemctl restart bibi-backend nginx

echo -e ""
echo -e "${GREEN}================================================================${NC}"
echo -e "${GREEN}  ✓ ¡DROPLET VINCULADO A Tecnomundo235/Server-3 CON ÉXITO!      ${NC}"
echo -e "${GREEN}================================================================${NC}"
echo -e "✓ Repositorio:   $(git remote get-url origin)"
echo -e "✓ Rama:          $(git branch --show-current)"
echo -e "✓ Último Commit: $(git log -1 --oneline)"
echo -e "✓ Backend:       $(systemctl is-active bibi-backend)"
echo -e "✓ Nginx:         $(systemctl is-active nginx)"
echo -e "================================================================"
