export interface VPSStatus {
  online: boolean;
  totalProductos?: number;
  mode?: string;
  error?: string;
}

export function isVpsHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === '143.198.163.70' || 
         h === '64.227.15.171' || 
         h === 'localhost' ||
         /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

export async function checkVPSOnline(): Promise<VPSStatus> {
  try {
    const res = await fetch('/api/vps/status', { method: 'GET', cache: 'no-store' });
    if (!res.ok) return { online: false };
    const data = await res.json();
    return {
      online: true,
      totalProductos: data.totalProductos,
      mode: data.mode
    };
  } catch (err: any) {
    return { online: false, error: err.message };
  }
}

export async function migrarTodoAVPS(payload: {
  productos: any[];
  config?: any;
  fiados?: any[];
  ventas?: any[];
}): Promise<{ success: boolean; totalProductos: number; mensaje: string }> {
  const res = await fetch('/api/vps/migracion-completa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error del servidor VPS' }));
    throw new Error(err.error || 'Error al enviar datos a la VPS');
  }

  return await res.json();
}

// Configuración (Tasa del dólar, etc.)
export async function getVPSConfig(): Promise<{ tasa_dolar?: number } | null> {
  try {
    const res = await fetch('/api/vps/config', { method: 'GET', cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function saveVPSConfig(config: { tasa_dolar: number; [key: string]: any }): Promise<boolean> {
  try {
    const res = await fetch('/api/vps/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Productos (CRUD)
export async function getVPSProductos(): Promise<any[]> {
  try {
    const res = await fetch('/api/vps/productos', { method: 'GET', cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function saveVPSProducto(producto: any): Promise<boolean> {
  try {
    const res = await fetch('/api/vps/productos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(producto)
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteVPSProducto(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/vps/productos/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Ventas
export async function getVPSVentas(): Promise<any[]> {
  try {
    const res = await fetch('/api/vps/ventas', { method: 'GET', cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function saveVPSVenta(venta: any): Promise<boolean> {
  try {
    const res = await fetch('/api/vps/ventas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(venta)
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Fiados
export async function getVPSFiados(): Promise<any[]> {
  try {
    const res = await fetch('/api/vps/fiados', { method: 'GET', cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function saveVPSFiado(fiado: any): Promise<boolean> {
  try {
    const res = await fetch('/api/vps/fiados', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fiado)
    });
    return res.ok;
  } catch {
    return false;
  }
}

