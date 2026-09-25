#!/usr/bin/env bash
# ==============================================================================
# SCRIPT DE RE-VINCULACIÓN TOTAL DE LA VPS AL NUEVO PROYECTO
# VPS IP: 143.198.163.70 (ubuntu-s-1vcpu-1gb-nyc1)
# Droplet: Ubuntu 24.04 (LTS) x64
# ==============================================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}  VINCULANDO DROPLET 143.198.163.70 AL NUEVO PROYECTO BIBI STORE${NC}"
echo -e "${BLUE}================================================================${NC}"

# 1. Detener servicios previos si existían
echo -e "${YELLOW}[1/7] Deteniendo servicios anteriores y liberando puertos...${NC}"
systemctl stop bibi-backend || true
pkill -f vps_server || true
pkill -f "node.*5000" || true

# 2. Respaldar datos existentes por seguridad
echo -e "${YELLOW}[2/7] Asegurando copia de seguridad previa...${NC}"
mkdir -p /var/www/bibi-store/backups_historicos
if [ -d "/var/www/bibi-store/data" ]; then
  cp -r /var/www/bibi-store/data /var/www/bibi-store/backups_historicos/backup_$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
fi

# 3. Preparar directorios limpios
echo -e "${YELLOW}[3/7] Preparando directorios en /var/www/bibi-store...${NC}"
mkdir -p /var/www/bibi-store/dist
mkdir -p /var/www/bibi-store/server
mkdir -p /var/www/bibi-store/data
mkdir -p /var/www/bibi-store/public/uploads/productos

# 4. Descargar e instalar la interfaz compilada del nuevo proyecto
echo -e "${YELLOW}[4/7] Descargando frontend actualizado del nuevo proyecto...${NC}"
APP_URL="https://ais-pre-6a2jedu7xg5flrxmet2ne5-872654649780.us-east1.run.app"

rm -rf /var/www/bibi-store/dist/*
if curl -fsSL "${APP_URL}/bibi-store-dist.tar.gz" -o /tmp/bibi-store-dist.tar.gz; then
  tar -xzf /tmp/bibi-store-dist.tar.gz -C /var/www/bibi-store/dist
  rm -f /tmp/bibi-store-dist.tar.gz
  echo "✓ Nueva interfaz instalada correctamente."
else
  echo -e "${RED}Aviso: No se pudo descargar el tarball comprimido remoto.${NC}"
fi

# 5. Dependencias necesarias
echo -e "${YELLOW}[5/7] Verificando dependencias en Node.js...${NC}"
cd /var/www/bibi-store
npm install --omit=dev express || true

# 6. Escribir el nuevo servidor backend con soporte de Chunks y desacople de Base64
echo -e "${YELLOW}[6/7] Desplegando el motor backend autónomo vps_server.cjs...${NC}"
cat << 'EOF' > /var/www/bibi-store/server/vps_server.cjs
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'productos');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));

const PRODUCTOS_FILE = path.join(DATA_DIR, 'productos.json');
const VENTAS_FILE = path.join(DATA_DIR, 'ventas.json');
const FIADOS_FILE = path.join(DATA_DIR, 'fiados.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function readJSON(filePath, defaultValue = []) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
      return defaultValue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content || '[]');
  } catch (e) {
    return defaultValue;
  }
}

let writeLock = Promise.resolve();
function writeJSONAsync(filePath, data) {
  writeLock = writeLock.then(async () => {
    try {
      const tempPath = `${filePath}.${Date.now()}.tmp`;
      await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
      await fs.promises.rename(tempPath, filePath);
      return true;
    } catch (e) {
      console.error(`Error escribiendo ${filePath}:`, e);
      return false;
    }
  });
  return writeLock;
}

const MIME_MAP = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg'
};

async function decoupleBase64Image(rawImage, productId) {
  if (!rawImage || typeof rawImage !== 'string' || !rawImage.startsWith('data:image/')) {
    return { url: rawImage || '', decoupled: false };
  }
  try {
    const matches = rawImage.match(/^data:([a-zA-Z0-9\/+.-]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return { url: rawImage, decoupled: false };

    const mime = matches[1].toLowerCase();
    const ext = MIME_MAP[mime] || 'jpg';
    const buffer = Buffer.from(matches[2], 'base64');
    if (buffer.length === 0) return { url: '', decoupled: false };

    const hash = crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 10);
    const sanitizedId = String(productId).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 24);
    const fileName = `${sanitizedId}_${hash}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, fileName);

    try {
      await fs.promises.access(filePath);
    } catch {
      await fs.promises.writeFile(filePath, buffer);
    }

    return { url: `/uploads/productos/${fileName}`, decoupled: true };
  } catch (err) {
    return { url: rawImage, decoupled: false };
  }
}

app.get('/api/vps/status', (req, res) => {
  const productos = readJSON(PRODUCTOS_FILE, []);
  res.json({
    status: 'online',
    ip: '143.198.163.70',
    appId: 'ebd8dcb8-1a95-41e8-acf6-6e720151327f',
    mode: 'autonomous_vps_wal',
    totalProductos: productos.length,
    features: ['chunked_restore', 'image_decoupling', 'atomic_upsert'],
    timestamp: new Date().toISOString()
  });
});

app.post('/api/vps/restore-chunk', async (req, res) => {
  try {
    const { items, batchIndex, totalBatches, config } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Chunk vacío' });
    }

    const currentProductos = readJSON(PRODUCTOS_FILE, []);
    let createdCount = 0;
    let updatedCount = 0;
    let imagesDecoupledCount = 0;

    for (const item of items) {
      if (!item || !item.nombre) continue;
      const id = item.id ? String(item.id).trim() : `prod_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const rawImage = item.imagen_url || item.imagen;
      const { url: finalImageUrl, decoupled } = await decoupleBase64Image(rawImage, id);
      if (decoupled) imagesDecoupledCount++;

      const normalizedItem = {
        id,
        nombre: String(item.nombre).trim(),
        codigo_barras: item.codigo_barras ? String(item.codigo_barras).trim() : '',
        precio_usd: Number(item.precio_usd) >= 0 ? Number(item.precio_usd) : 0,
        stock: Number(item.stock) || 0,
        unidad_medida: item.unidad_medida === 'kg' ? 'kg' : 'unid',
        categoria: item.categoria || item.categoria_nombre || 'Víveres',
        imagen_url: finalImageUrl,
        costo_usd: item.costo_usd != null ? Number(item.costo_usd) : undefined,
        updated_at: Date.now()
      };

      const idx = currentProductos.findIndex(p => 
        p.id === normalizedItem.id || 
        (normalizedItem.codigo_barras && p.codigo_barras === normalizedItem.codigo_barras)
      );

      if (idx >= 0) {
        currentProductos[idx] = {
          ...currentProductos[idx],
          ...normalizedItem,
          imagen_url: normalizedItem.imagen_url || currentProductos[idx].imagen_url
        };
        updatedCount++;
      } else {
        currentProductos.unshift(normalizedItem);
        createdCount++;
      }
    }

    await writeJSONAsync(PRODUCTOS_FILE, currentProductos);
    if (config) {
      const currentConfig = readJSON(CONFIG_FILE, {});
      await writeJSONAsync(CONFIG_FILE, { ...currentConfig, ...config });
    }

    return res.json({
      success: true,
      batchIndex: Number(batchIndex) || 1,
      totalBatches: Number(totalBatches) || 1,
      createdCount,
      updatedCount,
      imagesDecoupledCount,
      totalEnVPS: currentProductos.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vps/productos', (req, res) => {
  res.json(readJSON(PRODUCTOS_FILE, []));
});

app.post('/api/vps/productos', async (req, res) => {
  try {
    const nuevo = req.body;
    if (!nuevo.nombre) return res.status(400).json({ error: 'Nombre es requerido' });
    const productos = readJSON(PRODUCTOS_FILE, []);
    const id = nuevo.id || `prod_${Date.now()}`;
    const { url } = await decoupleBase64Image(nuevo.imagen_url || nuevo.imagen, id);
    const item = { ...nuevo, id, imagen_url: url };

    const idx = productos.findIndex(p => p.id === id);
    if (idx >= 0) productos[idx] = item;
    else productos.unshift(item);

    await writeJSONAsync(PRODUCTOS_FILE, productos);
    res.json({ success: true, producto: item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/vps/productos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let productos = readJSON(PRODUCTOS_FILE, []);
    productos = productos.filter(p => p.id !== id);
    await writeJSONAsync(PRODUCTOS_FILE, productos);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vps/ventas', (req, res) => res.json(readJSON(VENTAS_FILE, [])));
app.post('/api/vps/ventas', async (req, res) => {
  try {
    const venta = req.body;
    const ventas = readJSON(VENTAS_FILE, []);
    const id = venta.id || `venta_${Date.now()}`;
    const nuevaVenta = { ...venta, id, fecha: venta.fecha || Date.now() };
    ventas.unshift(nuevaVenta);
    await writeJSONAsync(VENTAS_FILE, ventas);
    res.json({ success: true, venta: nuevaVenta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vps/fiados', (req, res) => res.json(readJSON(FIADOS_FILE, [])));
app.post('/api/vps/fiados', async (req, res) => {
  try {
    const fiado = req.body;
    const fiados = readJSON(FIADOS_FILE, []);
    const id = fiado.id || `fiado_${Date.now()}`;
    const idx = fiados.findIndex(f => f.id === id);
    if (idx >= 0) fiados[idx] = { ...fiados[idx], ...fiado };
    else fiados.unshift({ ...fiado, id, fecha: fiado.fecha || Date.now() });
    await writeJSONAsync(FIADOS_FILE, fiados);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vps/config', (req, res) => res.json(readJSON(CONFIG_FILE, { tasa_dolar: 50 })));
app.post('/api/vps/config', async (req, res) => {
  try {
    const config = req.body;
    await writeJSONAsync(CONFIG_FILE, config);
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[BIBI STORE VPS] Corriendo en puerto ${PORT} (143.198.163.70)`);
});
EOF

# Configurar servicio systemd
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
echo -e "${YELLOW}[7/7] Configurando Nginx para 143.198.163.70...${NC}"
cat << 'EOF' > /etc/nginx/sites-available/bibi-store
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name 143.198.163.70 _;

    root /var/www/bibi-store/dist;
    index index.html;

    client_max_body_size 100M;
    client_body_buffer_size 128k;

    location /uploads/ {
        alias /var/www/bibi-store/public/uploads/;
        expires 30d;
        access_log off;
        add_header Cache-Control "public, max-age=2592000, immutable";
        try_files $uri =404;
    }

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

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/*
ln -sf /etc/nginx/sites-available/bibi-store /etc/nginx/sites-enabled/bibi-store
nginx -t && systemctl restart nginx

# Permisos
chown -R www-data:www-data /var/www/bibi-store
chmod -R 755 /var/www/bibi-store

echo -e ""
echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}  ¡DROPLET 143.198.163.70 VINCULADO AL NUEVO PROYECTO!          ${NC}"
echo -e "${BLUE}================================================================${NC}"
echo -e "✓ Backend activo: $(systemctl is-active bibi-backend)"
echo -e "✓ Nginx activo:   $(systemctl is-active nginx)"
echo -e "✓ ID Proyecto:    ebd8dcb8-1a95-41e8-acf6-6e720151327f"
echo -e "✓ URL de Tienda:  http://143.198.163.70"
echo -e "✓ Panel Ajustes:  http://143.198.163.70/ajustes"
echo -e "${BLUE}================================================================${NC}"
