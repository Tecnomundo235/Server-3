export const CATEGORIAS_PRODUCTO = [
  'Víveres', 
  'Quincalleria', 
  'Papelería', 
  'Higiene Personal', 
  'Farmacia', 
  'Limpieza', 
  'Panadería', 
  'Chucherías', 
  'Charcutería', 
  'Especies y Condimentos', 
  'Heladería y Bebidas', 
  'Vicios',
  'Frutas y Verduras',
  'Pollo y Carne'
];

export interface Producto {
  id: string;
  nombre: string;
  precio_usd: number;
  stock: number;
  codigo_barras: string;
  imagen_url?: string;
  unidad_medida?: 'unid' | 'kg';
  categoria?: string;
}

export interface CostoProducto {
  costo_usd: number;
}

export interface VentaItem {
  productoId: string;
  nombre: string;
  cantidad: number;
  precio_unitario_usd: number;
  subtotal_usd: number;
  unidad_medida?: 'unid' | 'kg';
  categoria?: string;
}

export interface Venta {
  id: string;
  total_usd: number;
  total_ved: number;
  fecha: number;
  vendedor_id: string;
  items: Array<{
    productoId: string;
    nombre?: string;
    cantidad: number;
    precio_unitario_usd: number;
    categoria?: string;
  }>;
  ganancia_estimada_usd?: number;
  metodo_pago?: string; // e.g. "Efectivo", "Pago Móvil", "Punto"
}

export interface Fiado {
  id: string;
  cliente: string;
  monto_usd: number;
  fecha: number;
  estado: 'pendiente' | 'pagado';
  descripcion?: string;
  historial_abonos?: Array<{
    monto_usd: number;
    fecha: number;
  }>;
}

export interface Config {
  tasa_dolar: number;
}
