const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

// Allow large payloads if needed, though chunking is preferred
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Data & Uploads directories
const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'productos');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Servir archivos estáticos desacoplados
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));

const PRODUCTOS_FILE = path.join(DATA_DIR, 'productos.json');
const VENTAS_FILE = path.join(DATA_DIR, 'ventas.json');
const FIADOS_FILE = path.join(DATA_DIR, 'fiados.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Helper to read JSON safely
function readJSON(filePath, defaultValue = []) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
      return defaultValue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content || '[]');
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e);
    return defaultValue;
  }
}

// Atomic & Asynchronous write to prevent 0-byte file corruption and event-loop freeze
let writeLock = Promise.resolve();
function writeJSONAsync(filePath, data) {
  writeLock = writeLock.then(async () => {
    try {
      const tempPath = `${filePath}.${Date.now()}.tmp`;
      const jsonStr = JSON.stringify(data, null, 2);
      await fs.promises.writeFile(tempPath, jsonStr, 'utf8');
      await fs.promises.rename(tempPath, filePath);
      return true;
    } catch (e) {
      console.error(`Error writing ${filePath}:`, e);
      return false;
    }
  });
  return writeLock;
}

// Pipeline de desacople de imágenes Base64 a disco VPS
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
    if (!matches || matches.length !== 3) {
      return { url: rawImage, decoupled: false };
    }

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
    console.error(`[Decouple] Error procesando imagen de ${productId}:`, err);
    return { url: rawImage, decoupled: false };
  }
}

// 1. Status & Health
app.get('/api/vps/status', (req, res) => {
  const productos = readJSON(PRODUCTOS_FILE, []);
  res.json({
    status: 'online',
    mode: 'autonomous_vps_wal',
    totalProductos: productos.length,
    features: ['chunked_restore', 'image_decoupling', 'atomic_upsert'],
    timestamp: new Date().toISOString()
  });
});

// 2. NUEVO ENDPOINT DE RESTAURACIÓN POR LOTES (CHUNKS)
app.post('/api/vps/restore-chunk', async (req, res) => {
  try {
    const { items, batchIndex, totalBatches, config } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Se esperaba un array no vacío de items en el chunk.' });
    }

    const currentProductos = readJSON(PRODUCTOS_FILE, []);
    let createdCount = 0;
    let updatedCount = 0;
    let imagesDecoupledCount = 0;

    for (const item of items) {
      if (!item || !item.nombre) continue;

      const id = item.id ? String(item.id).trim() : `prod_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const rawImage = item.imagen_url || item.imagen;

      // Desacoplar imagen a disco VPS
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

      // UPSERT atómico por ID o por Código de Barras
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

    // Guardar asíncronamente
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
    console.error('Error en restore-chunk:', err);
    res.status(500).json({ error: err.message || 'Error procesando lote en VPS' });
  }
});

// 3. Migración Completa Monolítica (Optimizada con desacople automático de fotos)
app.post('/api/vps/migracion-completa', async (req, res) => {
  try {
    const { productos, config, fiados, ventas } = req.body;

    if (!productos || !Array.isArray(productos)) {
      return res.status(400).json({ error: 'Formato inválido. Se esperaba un array de productos.' });
    }

    let decoupledCount = 0;
    const sanitizedProductos = [];

    // Desacoplar Base64 para no inflar productos.json
    for (const p of productos) {
      const rawImage = p.imagen_url || p.imagen;
      const { url, decoupled } = await decoupleBase64Image(rawImage, p.id || 'p');
      if (decoupled) decoupledCount++;

      sanitizedProductos.push({
        ...p,
        imagen_url: url
      });
    }

    // Si ya existen productos en la VPS (ej: 710 productos restaurados), hacer UPSERT
    // para no destruir los 710 productos al recibir una sincronización parcial de 100 productos
    const currentProductos = readJSON(PRODUCTOS_FILE, []);
    const idMap = new Map();
    const barcodeMap = new Map();
    currentProductos.forEach((p, idx) => {
      if (p.id) idMap.set(String(p.id), idx);
      if (p.codigo_barras) barcodeMap.set(String(p.codigo_barras), idx);
    });

    for (const p of sanitizedProductos) {
      let idx = -1;
      if (p.id && idMap.has(String(p.id))) {
        idx = idMap.get(String(p.id));
      } else if (p.codigo_barras && barcodeMap.has(String(p.codigo_barras))) {
        idx = barcodeMap.get(String(p.codigo_barras));
      }

      if (idx >= 0) {
        currentProductos[idx] = {
          ...currentProductos[idx],
          ...p,
          imagen_url: p.imagen_url || currentProductos[idx].imagen_url
        };
      } else {
        currentProductos.unshift(p);
      }
    }

    // Guardar productos asíncronamente preservando el total
    await writeJSONAsync(PRODUCTOS_FILE, currentProductos);

    if (config) {
      const currentConfig = readJSON(CONFIG_FILE, {});
      await writeJSONAsync(CONFIG_FILE, { ...currentConfig, ...config });
    }

    if (fiados && Array.isArray(fiados)) {
      await writeJSONAsync(FIADOS_FILE, fiados);
    }

    if (ventas && Array.isArray(ventas)) {
      await writeJSONAsync(VENTAS_FILE, ventas);
    }

    // Timestamped backup sin Base64 pesadas
    const backupName = path.join(DATA_DIR, `backup_${Date.now()}.json`);
    await writeJSONAsync(backupName, { 
      total: currentProductos.length, 
      fecha: new Date().toISOString() 
    });

    console.log(`[MIGRACIÓN EXITOSA] ${currentProductos.length} productos en base de datos. ${decoupledCount} imágenes desacopladas a disco.`);
    return res.json({
      success: true,
      mensaje: `Migración completada exitosamente en la VPS.`,
      totalProductos: currentProductos.length,
      imagesDecoupled: decoupledCount
    });
  } catch (err) {
    console.error('Error en migración:', err);
    res.status(500).json({ error: err.message || 'Error guardando datos en VPS' });
  }
});

// 4. Productos Endpoints
app.get('/api/vps/productos', (req, res) => {
  const productos = readJSON(PRODUCTOS_FILE, []);
  res.json(productos);
});

app.post('/api/vps/productos', async (req, res) => {
  try {
    const nuevo = req.body;
    if (!nuevo.nombre) {
      return res.status(400).json({ error: 'Nombre es requerido' });
    }

    const productos = readJSON(PRODUCTOS_FILE, []);
    const id = nuevo.id || `prod_${Date.now()}`;
    const { url } = await decoupleBase64Image(nuevo.imagen_url || nuevo.imagen, id);

    const item = { ...nuevo, id, imagen_url: url };

    const idx = productos.findIndex(p => p.id === id);
    if (idx >= 0) {
      productos[idx] = item;
    } else {
      productos.unshift(item);
    }

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

// 5. Ventas Endpoints
app.get('/api/vps/ventas', (req, res) => {
  const ventas = readJSON(VENTAS_FILE, []);
  res.json(ventas);
});

app.post('/api/vps/ventas', async (req, res) => {
  try {
    const venta = req.body;
    const ventas = readJSON(VENTAS_FILE, []);
    const id = venta.id || `venta_${Date.now()}`;
    const nuevaVenta = { ...venta, id, fecha: venta.fecha || Date.now() };

    ventas.unshift(nuevaVenta);
    await writeJSONAsync(VENTAS_FILE, ventas);

    // Update stock in productos
    if (venta.items && Array.isArray(venta.items)) {
      const productos = readJSON(PRODUCTOS_FILE, []);
      venta.items.forEach(item => {
        const prod = productos.find(p => p.id === item.productoId);
        if (prod && typeof prod.stock === 'number') {
          prod.stock = Math.max(0, prod.stock - (Number(item.cantidad) || 0));
        }
      });
      await writeJSONAsync(PRODUCTOS_FILE, productos);
    }

    res.json({ success: true, venta: nuevaVenta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Fiados Endpoints
app.get('/api/vps/fiados', (req, res) => {
  const fiados = readJSON(FIADOS_FILE, []);
  res.json(fiados);
});

app.post('/api/vps/fiados', async (req, res) => {
  try {
    const fiado = req.body;
    const fiados = readJSON(FIADOS_FILE, []);
    const id = fiado.id || `fiado_${Date.now()}`;
    const idx = fiados.findIndex(f => f.id === id);

    if (idx >= 0) {
      fiados[idx] = { ...fiados[idx], ...fiado };
    } else {
      fiados.unshift({ ...fiado, id, fecha: fiado.fecha || Date.now() });
    }

    await writeJSONAsync(FIADOS_FILE, fiados);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Configuración
app.get('/api/vps/config', (req, res) => {
  const config = readJSON(CONFIG_FILE, { tasa_dolar: 50 });
  res.json(config);
});

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
  console.log(`[BIBI STORE VPS BACKEND] Corriendo en http://0.0.0.0:${PORT} con desacople de fotos y WAL`);
});
