import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';

export interface ProductoExportJSON {
  id: string;
  nombre: string;
  precio_usd: number;
  costo_usd: number;
  stock: number;
  unidad_medida: 'unid' | 'kg';
  categoria?: string;
  codigo_barras?: string;
  imagen_url: string;
}

/**
 * Obtiene todos los productos con datos completos (nombre, precios, costos, stock, códigos e imágenes).
 * Si se pasan productos en memoria/localStorage, los usa directamente para no consumir cuotas.
 */
export async function exportarProductosJSON(productosMemoria?: any[]): Promise<ProductoExportJSON[]> {
  if (productosMemoria && productosMemoria.length > 0) {
    return productosMemoria.map((p) => ({
      id: String(p.id),
      nombre: String(p.nombre || ''),
      precio_usd: typeof p.precio_usd === 'number' ? p.precio_usd : (Number(p.precio_usd) || 0),
      costo_usd: typeof p.costo_usd === 'number' ? p.costo_usd : (Number(p.costo_usd) || 0),
      stock: typeof p.stock === 'number' ? p.stock : (Number(p.stock) || 0),
      unidad_medida: p.unidad_medida === 'kg' ? 'kg' : 'unid',
      categoria: p.categoria || 'Varios',
      codigo_barras: p.codigo_barras || '',
      imagen_url: String(p.imagen_url || p.imagen || '')
    }));
  }

  let prodSnap;
  try {
    prodSnap = await getDocs(collection(db, 'productos'));
  } catch (err: any) {
    console.error("Error al obtener la colección 'productos' de Firestore:", err);
    throw new Error(`Error al leer productos de Firestore: ${err?.message || err}`);
  }
  
  const costosMap: Record<string, number> = {};
  try {
    const costSnap = await getDocs(collection(db, 'costos_productos'));
    costSnap.forEach((docSnap) => {
      const data = docSnap.data();
      const val = data.costo_usd ?? data.costo ?? 0;
      costosMap[docSnap.id] = typeof val === 'number' ? val : (Number(val) || 0);
    });
  } catch (err) {
    console.warn("No se pudieron obtener costos_productos (usando fallback 0):", err);
  }

  const resultado: ProductoExportJSON[] = prodSnap.docs.map((docSnap) => {
    const data = docSnap.data();
    
    // Mapeo flexible de precio
    const precioRaw = data.precio_usd ?? data.precio ?? data.precio_unitario_usd ?? 0;
    const precio_usd = typeof precioRaw === 'number' ? precioRaw : (Number(precioRaw) || 0);

    // Mapeo flexible de costo
    const costoRaw = costosMap[docSnap.id] ?? data.costo_usd ?? data.costo ?? 0;
    const costo_usd = typeof costoRaw === 'number' ? costoRaw : (Number(costoRaw) || 0);

    // Mapeo flexible de imagen
    const imagen_url = String(data.imagen_url ?? data.imagen ?? data.url_imagen ?? data.foto_url ?? data.image ?? '');

    return {
      id: docSnap.id,
      nombre: String(data.nombre || ''),
      precio_usd,
      costo_usd,
      stock: typeof data.stock === 'number' ? data.stock : (Number(data.stock) || 0),
      unidad_medida: data.unidad_medida === 'kg' ? 'kg' : 'unid',
      categoria: data.categoria || 'Varios',
      codigo_barras: data.codigo_barras || '',
      imagen_url
    };
  });

  return resultado;
}

export function descargarJSON(data: any, filename: string = 'productos.json') {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
