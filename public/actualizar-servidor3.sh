#!/usr/bin/env bash
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}   CAMBIANDO ORIGEN A REPOSITORIO: Tecnomundo235/Server-3       ${NC}"
echo -e "${BLUE}================================================================${NC}"

APP_DIR="/var/www/bibi-store"
REPO_URL="https://github.com/Tecnomundo235/Server-3.git"

# 1. Asegurar Memoria Swap
if [ $(swapon --show | wc -l) -le 1 ]; then
    echo "Activando 1GB Swap..."
    fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab || true
fi

# 2. Respaldar datos y uploads locales
mkdir -p /tmp/bibi_store_backup
[ -d "$APP_DIR/data" ] && cp -r "$APP_DIR/data" /tmp/bibi_store_backup/
[ -d "$APP_DIR/public/uploads" ] && cp -r "$APP_DIR/public/uploads" /tmp/bibi_store_backup/

# 3. Cambiar el remote de Git a Server-3
echo -e "${YELLOW}Cambiando origen de Git a $REPO_URL...${NC}"
cd "$APP_DIR"
git remote set-url origin "$REPO_URL" || git remote add origin "$REPO_URL" || true
git fetch origin || true

BRANCH="main"
if git rev-parse --verify origin/main >/dev/null 2>&1; then
    BRANCH="main"
elif git rev-parse --verify origin/master >/dev/null 2>&1; then
    BRANCH="master"
fi

git checkout -B "$BRANCH" "origin/$BRANCH" || true
git reset --hard "origin/$BRANCH" || true

# Restaurar datos
[ -d "/tmp/bibi_store_backup/data" ] && cp -r /tmp/bibi_store_backup/data "$APP_DIR/"
if [ -d "/tmp/bibi_store_backup/uploads" ]; then
    mkdir -p "$APP_DIR/public/uploads"
    cp -r /tmp/bibi_store_backup/uploads/* "$APP_DIR/public/uploads/" 2>/dev/null || true
fi
rm -rf /tmp/bibi_store_backup

# 4. Instalar y compilar
export NODE_OPTIONS="--max-old-space-size=768"
npm install --no-audit --no-fund || npm install --legacy-peer-deps || true
npm run build || true

# 5. Reiniciar servicios
systemctl daemon-reload
systemctl restart bibi-backend nginx

echo -e ""
echo -e "${GREEN}✓ ¡Completado! Repositorio actual: $(git remote get-url origin)${NC}"
echo -e "${GREEN}✓ Último commit: $(git log -1 --oneline)${NC}"
echo -e "${GREEN}✓ Estado Backend: $(systemctl is-active bibi-backend)${NC}"
echo -e "${GREEN}✓ Estado Nginx:   $(systemctl is-active nginx)${NC}"
