import { getDatabase } from '../db/sqlite.server';
import { processAndDecoupleImage } from './imagePipeline.server';

export interface RawBackupProducto {
  id?: string;
  nombre: string;
  codigo_barras?: string | null;
  precio_usd?: number;
  stock?: number;
  unidad_medida?: 'unid' | 'kg' | string;
  categoria?: string | null;
  categoria_nombre?: string | null;
  imagen_url?: string | null;
  costo_usd?: number | null;
  [key: string]: any;
}

export interface BatchRestoreOptions {
  tasaDolarReferencial?: number;
  uploadsDir?: string;
}

export interface BatchRestoreResult {
  success: boolean;
  totalReceived: number;
  createdCount: number;
  updatedCount: number;
  imagesDecoupledCount: number;
  errors: Array<{ index: number; productoId?: string; error: string }>;
  durationMs: number;
}

/**
 * Normaliza y garantiza la existencia de una categoría en la base de datos
 */
function ensureCategoria(db: any, categoriaNombre?: string | null): { id: string; nombre: string } | null {
  if (!categoriaNombre || typeof categoriaNombre !== 'string') return null;
  const nombreLimpio = categoriaNombre.trim();
  if (!nombreLimpio) return null;

  const findStmt = db.prepare(`SELECT id, nombre FROM categorias WHERE LOWER(nombre) = LOWER(?) LIMIT 1`);
  const existing = findStmt.get(nombreLimpio);

  if (existing) {
    return existing;
  }

  const id = `cat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const insertStmt = db.prepare(`
    INSERT INTO categorias (id, nombre, created_at)
    VALUES (?, ?, ?)
  `);
  insertStmt.run(id, nombreLimpio, Date.now());

  return { id, nombre: nombreLimpio };
}

/**
 * Procesa un lote (chunk) de productos (50-100 registros) de forma atómica y no bloqueante.
 */
export async function processProductsBatch(
  items: RawBackupProducto[],
  options: BatchRestoreOptions = {}
): Promise<BatchRestoreResult> {
  const startTime = Date.now();
  const db = getDatabase();

  let createdCount = 0;
  let updatedCount = 0;
  let imagesDecoupledCount = 0;
  const errors: Array<{ index: number; productoId?: string; error: string }> = [];

  // 1. Fase Previa Asíncrona: Desacople de imágenes en disco sin bloquear la transacción SQL
  const preparedItems: Array<{
    raw: RawBackupProducto;
    id: string;
    nombre: string;
    codigoBarras: string | null;
    precioUsd: number;
    stock: number;
    unidadMedida: 'unid' | 'kg';
    categoriaNombre: string | null;
    finalImageUrl: string | null;
    costoUsd: number | null;
    imageDecoupled: boolean;
  }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      if (!item || !item.nombre) {
        errors.push({ index: i, error: 'Producto sin nombre o nulo' });
        continue;
      }

      const prodId = item.id ? String(item.id).trim() : `prod_${Date.now()}_${i}`;
      const rawImage = item.imagen_url || item.imagen || null;

      // Desacoplar Base64 a binario en disco si es necesario
      const imageResult = await processAndDecoupleImage(rawImage, prodId, options.uploadsDir);
      if (imageResult.isDecoupled) {
        imagesDecoupledCount++;
      }

      const unidadMedida: 'unid' | 'kg' = item.unidad_medida === 'kg' ? 'kg' : 'unid';
      const precioUsd = Number(item.precio_usd) >= 0 ? Number(item.precio_usd) : 0;
      const stock = Number(item.stock) || 0;
      const codigoBarras = item.codigo_barras ? String(item.codigo_barras).trim() : null;
      const categoriaNombre = item.categoria || item.categoria_nombre || null;
      const costoUsd = item.costo_usd != null && !isNaN(Number(item.costo_usd)) ? Number(item.costo_usd) : null;

      preparedItems.push({
        raw: item,
        id: prodId,
        nombre: String(item.nombre).trim(),
        codigoBarras,
        precioUsd,
        stock,
        unidadMedida,
        categoriaNombre,
        finalImageUrl: imageResult.imagenUrl || null,
        costoUsd,
        imageDecoupled: imageResult.isDecoupled
      });
    } catch (err: any) {
      errors.push({ index: i, productoId: item?.id, error: err.message || 'Error preparando producto' });
    }
  }

  // 2. Fase Transaccional SQLite (Atómica y Rápida en memoria WAL)
  const runTransaction = db.transaction((batchList: typeof preparedItems) => {
    // Sentencias preparadas reutilizables para máxima velocidad
    const selectByIdStmt = db.prepare(`SELECT id, imagen_url FROM productos WHERE id = ? LIMIT 1`);
    const selectByCodeStmt = db.prepare(`SELECT id, imagen_url FROM productos WHERE codigo_barras = ? AND codigo_barras IS NOT NULL AND codigo_barras != '' LIMIT 1`);

    const updateStmt = db.prepare(`
      UPDATE productos 
      SET nombre = ?, 
          codigo_barras = ?, 
          precio_usd = ?, 
          stock = ?, 
          unidad_medida = ?, 
          categoria_id = ?, 
          categoria_nombre = ?, 
          imagen_url = COALESCE(?, imagen_url), 
          updated_at = ?
      WHERE id = ?
    `);

    const insertStmt = db.prepare(`
      INSERT INTO productos (
        id, nombre, codigo_barras, precio_usd, stock, unidad_medida,
        categoria_id, categoria_nombre, imagen_url, activo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    const insertCostoStmt = db.prepare(`
      INSERT INTO costos_productos (
        id, producto_id, costo_usd, tasa_cambio_referencial, fecha, origen, nota
      ) VALUES (?, ?, ?, ?, ?, 'backup_restore', ?)
    `);

    const now = Date.now();

    for (const p of batchList) {
      // Normalizar categoría
      const cat = ensureCategoria(db, p.categoriaNombre);
      const catId = cat ? cat.id : null;
      const catName = cat ? cat.nombre : p.categoriaNombre;

      // Buscar si existe por ID únicamente (no por código de barras para no sobreescribir productos con códigos compartidos)
      let existing = selectByIdStmt.get(p.id);
      const targetId = existing ? existing.id : p.id;

      if (existing) {
        // UPSERT: Actualización preservando imagen si la nueva viene vacía
        const imageUrlToSave = p.finalImageUrl || existing.imagen_url;
        updateStmt.run(
          p.nombre,
          p.codigoBarras,
          p.precioUsd,
          p.stock,
          p.unidadMedida,
          catId,
          catName,
          imageUrlToSave,
          now,
          targetId
        );
        updatedCount++;
      } else {
        // UPSERT: Inserción atómica de nuevo registro
        insertStmt.run(
          targetId,
          p.nombre,
          p.codigoBarras,
          p.precioUsd,
          p.stock,
          p.unidadMedida,
          catId,
          catName,
          p.finalImageUrl,
          now,
          now
        );
        createdCount++;
      }

      // Registro del historial de costos si viene especificado
      if (p.costoUsd !== null && p.costoUsd >= 0) {
        const costoId = `costo_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        insertCostoStmt.run(
          costoId,
          targetId,
          p.costoUsd,
          options.tasaDolarReferencial || 50,
          now,
          `Restauración de catálogo: ${p.nombre}`
        );
      }
    }
  });

  // Ejecución atómica de la transacción para el lote
  try {
    runTransaction(preparedItems);
  } catch (txErr: any) {
    console.error('[BatchRestore] Error en la transacción SQLite:', txErr);
    throw new Error(`Fallo en la transacción de base de datos: ${txErr.message}`);
  }

  return {
    success: true,
    totalReceived: items.length,
    createdCount,
    updatedCount,
    imagesDecoupledCount,
    errors,
    durationMs: Date.now() - startTime
  };
}
