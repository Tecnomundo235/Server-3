import { createClient } from '@supabase/supabase-js';
import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';

export interface MigrationProgress {
  current: number;
  total: number;
  statusText: string;
  percent: number;
}

/**
 * Helper para convertir un data URL (base64) o URL a un Blob
 */
async function getBlobFromUrlOrBase64(urlOrBase64: string): Promise<{ blob: Blob; ext: string } | null> {
  if (!urlOrBase64 || typeof urlOrBase64 !== 'string') return null;

  try {
    if (urlOrBase64.startsWith('data:')) {
      const match = urlOrBase64.match(/^data:(image\/[a-zA-Z0-9+-]+);base64,/);
      const mimeType = match ? match[1] : 'image/jpeg';
      const ext = mimeType.split('/')[1] || 'jpg';
      
      const response = await fetch(urlOrBase64);
      const blob = await response.blob();
      return { blob, ext };
    } else if (urlOrBase64.startsWith('http')) {
      const response = await fetch(urlOrBase64);
      if (!response.ok) return null;
      const blob = await response.blob();
      const contentType = blob.type || 'image/jpeg';
      let ext = contentType.split('/')[1] || 'jpg';
      if (ext.includes(';')) ext = ext.split(';')[0];
      return { blob, ext };
    }
  } catch (err) {
    console.warn("No se pudo descargar la imagen para migración:", err);
  }
  return null;
}

export function generateSQLFromJSON(jsonData: any[], tasaDolar: number = 1): string {
  if (!Array.isArray(jsonData) || jsonData.length === 0) {
    return '-- El archivo JSON está vacío o no es un arreglo válido.';
  }

  function escapeSql(str: any): string {
    if (str === null || str === undefined) return 'NULL';
    const s = String(str).replace(/'/g, "''");
    return `'${s}'`;
  }

  function numSql(val: any): string {
    const n = Number(val);
    return isNaN(n) ? '0' : n.toString();
  }

  // Generar VALUES para UPSERT por id
  const valuesSql = jsonData.map(item => {
    const id = escapeSql(item.id || item.codigo_barra || item.codigo_barras);
    const precio_usd = numSql(item.precio_usd ?? item.precio ?? 0);
    const costo_usd = numSql(item.costo_usd ?? item.costo ?? 0);
    const precio_bs = numSql((Number(precio_usd) * tasaDolar).toFixed(2));
    const imagen_url = escapeSql(item.imagen_url ?? item.imagen ?? item.url_imagen ?? '');
    const nombre = escapeSql(item.nombre ?? '');
    const categoria = escapeSql(item.categoria ?? 'Sin Categoría');
    const stock = numSql(item.stock ?? 0);

    return `(${id}, ${precio_usd}, ${costo_usd}, ${precio_bs}, ${imagen_url}, ${nombre}, ${categoria}, ${stock})`;
  }).join(',\n  ');

  return `-- ==========================================================
-- SCRIPT AUTOMÁTICO DE DDL / UPSERT PARA SUPABASE SQL EDITOR
-- Generado el: ${new Date().toLocaleString()}
-- Total de productos: ${jsonData.length}
-- ==========================================================

-- 1. Asegurar que la tabla "productos" exista en Supabase
CREATE TABLE IF NOT EXISTS productos (
  id TEXT PRIMARY KEY,
  codigo_barra TEXT,
  nombre TEXT,
  categoria TEXT,
  precio_usd NUMERIC(10,2) DEFAULT 0,
  costo_usd NUMERIC(10,2) DEFAULT 0,
  precio_bs NUMERIC(10,2) DEFAULT 0,
  stock INT DEFAULT 0,
  imagen_url TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Insertar / Actualizar productos, precios, costos e imágenes
INSERT INTO productos (id, precio_usd, costo_usd, precio_bs, imagen_url, nombre, categoria, stock)
VALUES
  ${valuesSql}
ON CONFLICT (id) 
DO UPDATE SET
  precio_usd = EXCLUDED.precio_usd,
  costo_usd = EXCLUDED.costo_usd,
  precio_bs = EXCLUDED.precio_bs,
  imagen_url = CASE 
    WHEN EXCLUDED.imagen_url IS NOT NULL AND EXCLUDED.imagen_url != '' THEN EXCLUDED.imagen_url 
    ELSE productos.imagen_url 
  END,
  nombre = CASE 
    WHEN EXCLUDED.nombre IS NOT NULL AND EXCLUDED.nombre != '' THEN EXCLUDED.nombre 
    ELSE productos.nombre 
  END,
  categoria = CASE 
    WHEN EXCLUDED.categoria IS NOT NULL AND EXCLUDED.categoria != 'Sin Categoría' THEN EXCLUDED.categoria 
    ELSE productos.categoria 
  END;

-- Mensaje de verificación
SELECT count(*) AS total_productos_actualizados FROM productos;
`;
}

export async function handleDirectJSONImportToSupabase(
  supabaseUrl: string,
  supabaseKey: string,
  jsonData: any[],
  tasaDolar: number = 1,
  onProgress?: (p: MigrationProgress) => void
) {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Debe proporcionar la URL y la API Key de Supabase.');
  }

  if (!Array.isArray(jsonData) || jsonData.length === 0) {
    throw new Error('El archivo o texto JSON proporcionado está vacío o no es un arreglo.');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const total = jsonData.length;

  onProgress?.({
    current: 0,
    total,
    statusText: `Preparando ${total} productos desde el archivo JSON...`,
    percent: 10
  });

  const productosMapeados = jsonData.map((item, idx) => {
    const id = String(item.id || item.codigo_barra || item.codigo_barras || `prod_${idx + 1}`);
    const precio_usd = Number(item.precio_usd ?? item.precio ?? 0);
    const costo_usd = Number(item.costo_usd ?? item.costo ?? 0);
    return {
      id,
      codigo_barra: String(item.codigo_barra || item.codigo_barras || id),
      nombre: String(item.nombre || 'Producto importado'),
      categoria: String(item.categoria || 'Sin Categoría'),
      precio_usd,
      costo_usd,
      precio_bs: Number((precio_usd * tasaDolar).toFixed(2)),
      stock: Number(item.stock ?? 0),
      imagen_url: String(item.imagen_url ?? item.imagen ?? item.url_imagen ?? ''),
      activo: item.activo !== false
    };
  });

  // Procesar en lotes de 20 para evitar sobrecargar la API
  const batchSize = 20;
  let subidos = 0;

  for (let i = 0; i < total; i += batchSize) {
    const batch = productosMapeados.slice(i, i + batchSize);
    const currentNum = Math.min(i + batchSize, total);
    const percent = Math.round((currentNum / total) * 90);

    onProgress?.({
      current: currentNum,
      total,
      statusText: `Subiendo lote (${currentNum}/${total}) a Supabase DB...`,
      percent
    });

    const { error } = await supabase
      .from('productos')
      .upsert(batch, { onConflict: 'id' });

    if (error) {
      // Intentar onConflict: 'codigo_barra' si 'id' falla
      const { error: err2 } = await supabase
        .from('productos')
        .upsert(batch, { onConflict: 'codigo_barra' });

      if (err2) {
        throw new Error(`Error al insertar lote ${i / batchSize + 1}: ${err2.message}`);
      }
    }

    subidos += batch.length;
  }

  onProgress?.({
    current: total,
    total,
    statusText: '¡Importación de JSON completada exitosamente!',
    percent: 100
  });

  return { totalMigrados: subidos };
}

export async function handleAutomatedMigration(
  supabaseUrl: string,
  supabaseKey: string,
  tasaDolar: number = 1,
  onProgress?: (p: MigrationProgress) => void
) {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Debe proporcionar la URL y la API Key de Supabase.');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Obtener productos de Firestore
  onProgress?.({
    current: 0,
    total: 0,
    statusText: 'Obteniendo catálogo de Firestore...',
    percent: 5
  });

  const prodSnap = await getDocs(collection(db, 'productos'));
  
  const costosMap: Record<string, number> = {};
  try {
    const costSnap = await getDocs(collection(db, 'costos_productos'));
    costSnap.forEach((docSnap) => {
      const data = docSnap.data();
      const val = data.costo_usd ?? data.costo ?? 0;
      costosMap[docSnap.id] = typeof val === 'number' ? val : (Number(val) || 0);
    });
  } catch (err) {
    console.warn("No se obtuvieron costos_productos (usando 0 por defecto):", err);
  }

  const productosLocales = prodSnap.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      codigo_barra: String(data.codigo_barras || data.codigo_barra || docSnap.id),
      nombre: String(data.nombre || 'Producto sin nombre'),
      categoria: String(data.categoria || 'Sin Categoría'),
      precio_usd: Number(data.precio_usd ?? data.precio ?? 0),
      costo_usd: Number(costosMap[docSnap.id] ?? data.costo_usd ?? data.costo ?? 0),
      stock: Number(data.stock ?? 0),
      imagen_url: String(data.imagen_url ?? data.imagen ?? data.url_imagen ?? ''),
      activo: data.activo !== false
    };
  });

  const total = productosLocales.length;
  if (total === 0) {
    throw new Error('No hay productos en Firestore para migrar.');
  }

  const productosParaInsertar = [];

  for (let i = 0; i < total; i++) {
    const producto = productosLocales[i];
    const currentNum = i + 1;
    const progressPercent = Math.round(10 + (currentNum / total) * 70);

    onProgress?.({
      current: currentNum,
      total,
      statusText: `Procesando (${currentNum}/${total}): ${producto.nombre}`,
      percent: progressPercent
    });

    let finalPublicUrl = producto.imagen_url;

    // Step A & B: Subir imagen local/URL a Supabase Storage bucket 'productos'
    if (producto.imagen_url) {
      try {
        const imageData = await getBlobFromUrlOrBase64(producto.imagen_url);
        if (imageData) {
          const { blob, ext } = imageData;
          const cleanCodigo = producto.codigo_barra.replace(/[^a-zA-Z0-9_-]/g, '_');
          const fileName = `${cleanCodigo}.${ext}`;
          const filePath = `catálogo/${fileName}`;

          onProgress?.({
            current: currentNum,
            total,
            statusText: `Subiendo imagen para ${producto.nombre} a Supabase Storage...`,
            percent: progressPercent
          });

          const { error: storageError } = await supabase.storage
            .from('productos')
            .upload(filePath, blob, {
              upsert: true,
              contentType: blob.type || 'image/jpeg'
            });

          if (storageError) {
            console.warn(`Error al subir imagen de ${producto.nombre} a Supabase storage:`, storageError);
          } else {
            const { data: urlData } = supabase.storage
              .from('productos')
              .getPublicUrl(filePath);

            if (urlData?.publicUrl) {
              finalPublicUrl = urlData.publicUrl;
            }
          }
        }
      } catch (imgErr) {
        console.warn(`Falló el procesamiento de imagen para ${producto.nombre}:`, imgErr);
      }
    }

    // Step C: Mapear el producto con su URL pública
    productosParaInsertar.push({
      codigo_barra: producto.codigo_barra,
      nombre: producto.nombre,
      categoria: producto.categoria,
      precio_usd: producto.precio_usd,
      costo_usd: producto.costo_usd,
      precio_bs: Number((producto.precio_usd * tasaDolar).toFixed(2)),
      stock: producto.stock,
      imagen_url: finalPublicUrl,
      activo: producto.activo
    });
  }

  // Step D: Insertar / Actualizar en la base de datos Supabase
  onProgress?.({
    current: total,
    total,
    statusText: 'Insertando registros en la tabla "productos" de Supabase...',
    percent: 90
  });

  const { data, error: dbError } = await supabase
    .from('productos')
    .upsert(productosParaInsertar, { onConflict: 'codigo_barra' });

  if (dbError) {
    console.error('Error de Supabase DB:', dbError);
    throw new Error(`Error en base de datos Supabase: ${dbError.message}`);
  }

  onProgress?.({
    current: total,
    total,
    statusText: '¡Migración completada con éxito!',
    percent: 100
  });

  return {
    totalMigrados: productosParaInsertar.length,
    data
  };
}
