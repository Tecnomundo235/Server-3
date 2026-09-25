/**
 * ==============================================================================
 * ESQUEMA DE PERSISTENCIA PARA VPS (DigitalOcean) - BIBI STORE POS
 * ==============================================================================
 * Motor: SQLite en modo WAL (Write-Ahead Logging) o PostgreSQL
 * Soporte completo para:
 *  - Productos con unidad_medida ('unid', 'kg')
 *  - Códigos de barra únicos indexados
 *  - Desacople de URLs de imagen locales (/uploads/productos/...)
 *  - Historial auditable de costos (costos_productos)
 *  - Categorías normalizadas
 *  - Registro transaccional de ventas y partidas de venta
 */

// ------------------------------------------------------------------------------
// 1. DDL RAW SQL (Ejecutable directamente en SQLite en la VPS o mediante script)
// ------------------------------------------------------------------------------
export const SQLITE_INIT_DDL = `
-- Modo WAL y optimizaciones de rendimiento para VPS DigitalOcean (1GB RAM)
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA cache_size = -64000; -- 64MB cache en RAM
PRAGMA temp_store = MEMORY;
PRAGMA busy_timeout = 5000;

-- 1. Tabla de Categorías
CREATE TABLE IF NOT EXISTS categorias (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- 2. Tabla de Productos
CREATE TABLE IF NOT EXISTS productos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  codigo_barras TEXT,
  precio_usd REAL NOT NULL DEFAULT 0.0,
  stock REAL NOT NULL DEFAULT 0.0,
  unidad_medida TEXT NOT NULL DEFAULT 'unid' CHECK (unidad_medida IN ('unid', 'kg')),
  categoria_id TEXT REFERENCES categorias(id) ON DELETE SET NULL,
  categoria_nombre TEXT,
  imagen_url TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Índices críticos para búsqueda rápida y UPSERT sin colisiones
CREATE INDEX IF NOT EXISTS idx_productos_codigo_barras ON productos(codigo_barras);
CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_productos_nombre ON productos(nombre);

-- 3. Tabla de Historial de Costos (Auditoría de márgenes y compras)
CREATE TABLE IF NOT EXISTS costos_productos (
  id TEXT PRIMARY KEY,
  producto_id TEXT NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  costo_usd REAL NOT NULL,
  tasa_cambio_referencial REAL,
  fecha INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  origen TEXT DEFAULT 'backup_restore', -- 'backup_restore', 'manual', 'compra_proveedor'
  nota TEXT
);

CREATE INDEX IF NOT EXISTS idx_costos_producto_fecha ON costos_productos(producto_id, fecha DESC);

-- 4. Tabla de Ventas
CREATE TABLE IF NOT EXISTS ventas (
  id TEXT PRIMARY KEY,
  total_usd REAL NOT NULL,
  total_ved REAL NOT NULL,
  tasa_dolar REAL NOT NULL,
  vendedor_id TEXT,
  metodo_pago TEXT,
  ganancia_estimada_usd REAL DEFAULT 0.0,
  items_count INTEGER NOT NULL DEFAULT 0,
  items_json TEXT NOT NULL, -- Snapshot serializado de los ítems en el momento de la venta
  fecha INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha DESC);

-- 5. Tabla de Configuración General de la VPS
CREATE TABLE IF NOT EXISTS configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
`;

// ------------------------------------------------------------------------------
// 2. DEFINICIÓN DRIZZLE ORM (TypeScript Tipado para Remix / Vite)
// ------------------------------------------------------------------------------
export interface CategoriaRecord {
  id: string;
  nombre: string;
  descripcion?: string | null;
  created_at: number;
}

export interface ProductoRecord {
  id: string;
  nombre: string;
  codigo_barras?: string | null;
  precio_usd: number;
  stock: number;
  unidad_medida: 'unid' | 'kg';
  categoria_id?: string | null;
  categoria_nombre?: string | null;
  imagen_url?: string | null;
  activo: number;
  created_at: number;
  updated_at: number;
}

export interface CostoProductoRecord {
  id: string;
  producto_id: string;
  costo_usd: number;
  tasa_cambio_referencial?: number | null;
  fecha: number;
  origen?: string;
  nota?: string | null;
}

export interface VentaRecord {
  id: string;
  total_usd: number;
  total_ved: number;
  tasa_dolar: number;
  vendedor_id?: string | null;
  metodo_pago?: string | null;
  ganancia_estimada_usd?: number;
  items_count: number;
  items_json: string;
  fecha: number;
  created_at: number;
}
