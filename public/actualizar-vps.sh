#!/usr/bin/env bash
# ==============================================================================
# SCRIPT DE ACTUALIZACIÓN ULTRA-RÁPIDA (3 SEGUNDOS) PARA BIBI STORE EN VPS
# ==============================================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}   ACTUALIZANDO BIBI STORE EN DROPLET DIGITALOCEAN (143.198.163.70)${NC}"
echo -e "${BLUE}================================================================${NC}"

APP_URL="https://ais-pre-6a2jedu7xg5flrxmet2ne5-872654649780.us-east1.run.app"
DIST_DIR="/var/www/bibi-store/dist"

echo -e "${YELLOW}[1/3] Descargando la compilación más reciente...${NC}"
mkdir -p "$DIST_DIR"
curl -fsSL "${APP_URL}/bibi-store-dist.tar.gz" -o /tmp/bibi-store-dist.tar.gz

echo -e "${YELLOW}[2/3] Instalando nueva versión en $DIST_DIR...${NC}"
rm -rf ${DIST_DIR}/*
tar -xzf /tmp/bibi-store-dist.tar.gz -C "$DIST_DIR"
rm -f /tmp/bibi-store-dist.tar.gz

echo -e "${YELLOW}[3/3] Aplicando permisos y recargando servidor web Nginx...${NC}"
chown -R www-data:www-data "$DIST_DIR"
chmod -R 755 "$DIST_DIR"
systemctl reload nginx || systemctl restart nginx

echo -e ""
echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}  ✓ ¡ACTUALIZACIÓN COMPLETADA CON ÉXITO EN 3 SEGUNDOS!           ${NC}"
echo -e "${BLUE}================================================================${NC}"
echo -e "Cambios aplicados:"
echo -e "1. Solucionado el bloqueo de cámara en HTTP (nuevo botón de foto nativa de cámara)."
echo -e "2. Eliminado el error falso 'Error de conexión con la base de datos'."
echo -e "3. Soporte para entrada manual de códigos y carga desde galería."
echo -e ""
echo -e "Abre la tienda en tu navegador: 👉 ${BLUE}http://143.198.163.70${NC}"
echo -e "${BLUE}================================================================${NC}"
