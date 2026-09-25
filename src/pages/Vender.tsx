import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { collection, onSnapshot, doc, writeBatch, query, limit, where, getDocs, increment } from 'firebase/firestore';
import { useConfig } from '../contexts/ConfigContext';
import { useAuth } from '../contexts/AuthContext';
import { formatUSD, formatBs, cn } from '../lib/utils';
import { Producto, VentaItem, CATEGORIAS_PRODUCTO } from '../types';
import { Search, Trash2, Scan, X, ShoppingCart, UploadCloud, Database } from 'lucide-react';
import Scanner from '../components/Scanner';
import toast from 'react-hot-toast';
import { saveVPSVenta, migrarTodoAVPS } from '../lib/vpsService';

export default function Vender() {
  const { tasaDolar } = useConfig();
  const { user } = useAuth();
  
  const [productos, setProductos] = useState<Producto[]>(() => {
    try {
      const saved = localStorage.getItem('bibi_store_cached_productos');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [busqueda, setBusqueda] = useState('');
  
  const [carrito, setCarrito] = useState<VentaItem[]>([]);
  const [procesando, setProcesando] = useState(false);
  const [scannerAbierto, setScannerAbierto] = useState(false);
  const [showMobileCart, setShowMobileCart] = useState(false);

  
  // Weight Modal State
  const [modalPesoOpen, setModalPesoOpen] = useState(false);
  const [pesoProducto, setPesoProducto] = useState<Producto | null>(null);
  const [gramos, setGramos] = useState('');
  const [kilos, setKilos] = useState('');
  const [isEditingWeight, setIsEditingWeight] = useState(false);

  useEffect(() => {
    // 1. Intentar cargar desde el backend autónomo de la VPS
    fetch('/api/vps/productos')
      .then(r => r.ok ? r.json() : null)
      .then(vpsProds => {
        if (vpsProds && Array.isArray(vpsProds) && vpsProds.length > 0) {
          setProductos(vpsProds);
          try {
            localStorage.setItem('bibi_store_cached_productos', JSON.stringify(vpsProds));
          } catch {}
        }
      })
      .catch(() => {});

    // 2. Escuchar todos los productos para la venta en Firestore
    const q = query(collection(db, 'productos'));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Producto));
      setProductos(data);
      try {
        localStorage.setItem('bibi_store_cached_productos', JSON.stringify(data));
      } catch (e) {
        console.warn("No se pudo respaldar en localStorage:", e);
      }
    }, (err) => {
      console.error("Error cargando productos en Vender:", err);
      if (err.message?.includes("Quota limit") || (err as any).code === "resource-exhausted") {
        toast.error("Límite de lecturas gratuitas de Firebase alcanzado. Mostrando productos en memoria local.", { id: 'quota-err' });
      } else {
        toast.error("Error de conexión con la base de datos.", { id: 'conn-err' });
      }
    });
    return () => unsub();
  }, []);

  const handleSubirCopiaJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const toastId = toast.loading("Leyendo archivo JSON de copia de seguridad...");
    try {
      const text = await file.text();
      let parsed = JSON.parse(text);
      let prods: any[] = [];
      if (Array.isArray(parsed)) {
        prods = parsed;
      } else if (parsed && Array.isArray(parsed.productos)) {
        prods = parsed.productos;
      } else {
        throw new Error("El archivo no contiene un formato de lista de productos válido.");
      }

      if (prods.length === 0) {
        throw new Error("El archivo JSON no contiene productos.");
      }

      // 1. Guardar en memoria local
      setProductos(prods);
      try {
        localStorage.setItem('bibi_store_cached_productos', JSON.stringify(prods));
      } catch {}

      // 2. Enviar a la VPS
      try {
        await migrarTodoAVPS({ productos: prods });
      } catch (e) {
        console.warn("Aviso guardando en VPS:", e);
      }

      toast.success(`🎉 ¡Éxito! ${prods.length} productos cargados y listos para vender.`, { id: toastId, duration: 6000 });
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Error al procesar el archivo JSON", { id: toastId });
    }
  };

  const prodFiltrados = productos.filter(p => {
    const term = busqueda.toLowerCase();
    const matchNombre = p.nombre.toLowerCase().includes(term);
    const matchRef = p.codigo_barras && p.codigo_barras.toLowerCase().includes(term);
    return matchNombre || matchRef;
  });

  const agregarAlCarrito = (prod: Producto, weight?: number, replace: boolean = false) => {
    if (prod.unidad_medida === 'kg' && !weight) {
      setPesoProducto(prod);
      setGramos('');
      setKilos('');
      setIsEditingWeight(false);
      setModalPesoOpen(true);
      return;
    }

    const cantidadAAgregar = weight || 1;

    setCarrito(prev => {
      const ex = prev.find(i => i.productoId === prod.id);
      if (ex) {
        const nuevaCantidad = replace ? cantidadAAgregar : ex.cantidad + cantidadAAgregar;
        if (nuevaCantidad > prod.stock) {
          toast.error("No hay suficiente stock");
          return prev;
        }
        return prev.map(i => i.productoId === prod.id ? { ...i, cantidad: nuevaCantidad, subtotal_usd: nuevaCantidad * i.precio_unitario_usd } : i);
      }
      return [...prev, { 
        productoId: prod.id, 
        nombre: prod.nombre, 
        cantidad: cantidadAAgregar, 
        precio_unitario_usd: prod.precio_usd, 
        subtotal_usd: cantidadAAgregar * prod.precio_usd,
        unidad_medida: prod.unidad_medida,
        categoria: prod.categoria || 'Sin Categoría'
      }];
    });
    setModalPesoOpen(false);
  };

  const modificarCantidad = (prodId: string, delta: number) => {
    setCarrito(prev => prev.map(i => {
      if (i.productoId !== prodId) return i;
      const nw = i.cantidad + delta;
      if (nw <= 0) return i;
      const stockMax = productos.find(p => p.id === prodId)?.stock || 0;
      if (nw > stockMax) return i;
      return { ...i, cantidad: nw, subtotal_usd: nw * i.precio_unitario_usd };
    }));
  };

  const quitarDelCarrito = (prodId: string) => {
    setCarrito(prev => prev.filter(i => i.productoId !== prodId));
  };

  const totalUSD = carrito.reduce((acc, curr) => acc + curr.subtotal_usd, 0);
  const totalVED = totalUSD * tasaDolar;

  const procesarVenta = async () => {
    if (carrito.length === 0 || procesando) return;
    setProcesando(true);
    const loadingToast = toast.loading("Procesando venta...");
    try {
      const ventaData = {
        total_usd: totalUSD,
        total_ved: totalVED,
        fecha: Date.now(),
        vendedor_id: user?.uid || 'cajero',
        items: carrito.map(i => ({
          productoId: i.productoId,
          nombre: i.nombre,
          cantidad: i.cantidad,
          precio_unitario_usd: i.precio_unitario_usd,
          categoria: i.categoria || 'Sin Categoría'
        }))
      };

      // 1. Guardar en VPS (el backend de la VPS descuenta el stock en disco atómicamente)
      await saveVPSVenta(ventaData);

      // 2. Descontar stock localmente en memoria
      setProductos(prev => {
        const copy = [...prev];
        carrito.forEach(item => {
          const p = copy.find(x => x.id === item.productoId);
          if (p) p.stock = Math.max(0, p.stock - item.cantidad);
        });
        try {
          localStorage.setItem('bibi_store_cached_productos', JSON.stringify(copy));
        } catch {}
        return copy;
      });

      // 3. Sincronizar con Firestore en segundo plano (si está accesible)
      try {
        const batch = writeBatch(db);
        const repVenta = doc(collection(db, 'ventas'));
        batch.set(repVenta, ventaData);
        for (const item of carrito) {
          const pref = doc(db, 'productos', item.productoId);
          batch.update(pref, { stock: increment(-item.cantidad) });
        }
        await batch.commit();
      } catch (errSync) {
        console.warn("Firestore sync omitido (venta procesada y guardada en VPS):", errSync);
      }

      setCarrito([]);
      toast.success("🎉 Venta registrada con éxito", { id: loadingToast });
    } catch (err) {
      console.error("Error al vender:", err);
      toast.error("Error al procesar la venta en el servidor", { id: loadingToast });
    } finally {
      setProcesando(false);
    }
  };

  const buscarRemoto = async (codigo: string): Promise<Producto | null> => {
    try {
      const snap = await getDocs(query(collection(db, "productos"), where("codigo_barras", "==", codigo), limit(1)));
      if (!snap.empty) {
        return { id: snap.docs[0].id, ...snap.docs[0].data() } as Producto;
      }
      return null;
    } catch {
      return null;
    }
  };

  const handleScan = async (code: string) => {
    const term = code.toLowerCase();
    let match = productos.find(p => p.codigo_barras?.toLowerCase() === term);
    
    if (!match) {
      match = await buscarRemoto(code) || undefined;
    }

    if (match) {
      if (match.stock > 0) {
        agregarAlCarrito(match);
        toast.success(`Añadido: ${match.nombre}`);
      } else {
        toast.error(`El producto "${match.nombre}" está agotado.`);
      }
    } else {
      setBusqueda(code);
      toast.error("Producto no encontrado. Búsqueda manual activada.");
    }
  };

  const categoriasConProductos = [...CATEGORIAS_PRODUCTO, 'Sin Categoría'].filter(cat => 
    prodFiltrados.some(p => (p.categoria || 'Sin Categoría') === cat)
  );

  return (
    <div className="flex flex-col md:flex-row flex-1 overflow-hidden relative">
      {scannerAbierto && (
        <Scanner 
          onScan={handleScan} 
          onClose={() => setScannerAbierto(false)} 
          title="Venta: Escanear Producto" 
        />
      )}
      {/* Product Selection */}
      <section className="flex-1 p-4 md:p-6 flex flex-col space-y-6 overflow-hidden border-r border-gray-100 relative">
        <div className="flex space-x-4 items-center shrink-0">
          <div className="relative flex-1">
            <input 
              type="text" 
              placeholder="Buscar producto por nombre o código..." 
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border-2 border-black rounded-none focus:outline-none focus:ring-0 focus:border-yellow-500 text-sm"
            />
            <div className="absolute left-3 top-3.5 text-gray-400">
              <Search size={18} />
            </div>
          </div>
          <button 
            onClick={() => setScannerAbierto(true)}
            className="bg-black text-white px-6 py-3 font-bold text-sm uppercase tracking-wider hover:bg-zinc-800 transition-colors flex items-center gap-2"
          >
            <Scan size={18} />
            <span className="hidden sm:inline">Escanear</span>
          </button>
        </div>
        
        <div className="overflow-y-auto scroll-hide pb-20 md:pb-10 space-y-8 pr-2">
          {categoriasConProductos.map(cat => {
            const prodsCat = prodFiltrados.filter(p => (p.categoria || 'Sin Categoría') === cat);
            return (
              <div key={cat}>
                <h2 className="text-sm font-black uppercase tracking-widest bg-yellow-400 inline-block px-3 py-1 mb-4 border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                  {cat}
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {prodsCat.map(prod => (
                    <div 
                      key={prod.id} 
                      onClick={() => { if (prod.stock > 0) agregarAlCarrito(prod); }}
                      className={`border-2 border-gray-100 p-4 transition-all group flex flex-col ${prod.stock === 0 ? 'opacity-60 cursor-not-allowed' : 'hover:border-black cursor-pointer'}`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[10px] bg-gray-100 px-2 py-0.5 font-bold uppercase tracking-tighter truncate max-w-[50%]">{prod.categoria || 'Sin Categoría'}</span>
                        <span className={`text-[10px] font-bold uppercase ${prod.stock === 0 ? 'text-gray-400' : (prod.stock <= 5 ? 'text-red-600' : 'text-green-600')}`}>
                          {prod.stock === 0 ? 'Agotado' : (prod.stock <= 5 ? `Stock bajo: ${prod.stock}` : `Stock: ${prod.stock}`)}
                        </span>
                      </div>
                      <h3 className="font-bold text-lg mb-1 leading-tight flex-1">{prod.nombre}</h3>
                      <p className="text-xs text-gray-500 mb-3 truncate">Ref: {prod.codigo_barras || 'S/N'}</p>
                      
                      {prod.imagen_url && (
                        <div className="flex justify-center mb-4 h-24">
                           <img src={prod.imagen_url} alt={prod.nombre} className="h-full w-auto object-contain border-2 border-transparent mix-blend-multiply" />
                        </div>
                      )}
                      
                      <div className="flex justify-between items-end">
                        <div className="flex flex-col">
                          <span className="text-2xl font-extrabold">
                            {formatUSD(prod.precio_usd)}
                            <span className="text-[10px] ml-1 font-normal text-gray-400 uppercase">{prod.unidad_medida === 'kg' ? '/ Kg' : ''}</span>
                          </span>
                          <span className="text-[10px] font-mono text-gray-400">{formatBs(prod.precio_usd * tasaDolar).replace('Bs. ', '')} VED</span>
                        </div>
                        
                        {prod.stock > 0 ? (
                          <div className="p-2 bg-yellow-400 group-hover:bg-black group-hover:text-white transition-colors flex shrink-0 items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                            </svg>
                          </div>
                        ) : (
                          <div className="p-2 bg-gray-200 text-gray-400 flex shrink-0 items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {productos.length === 0 ? (
            <div className="col-span-full py-10 px-4 text-center border-2 border-dashed border-black bg-yellow-50/50 m-2 flex flex-col items-center justify-center">
              <Database size={40} className="text-black mb-2" />
              <h3 className="font-black text-sm uppercase tracking-wider text-black">Catálogo sin productos en este dispositivo</h3>
              <p className="text-xs text-gray-600 max-w-sm mt-1 mb-4 font-medium leading-relaxed">
                El límite de lecturas de Firebase está activo. Carga tu copia de seguridad <b>bibi_store_productos_completos.json</b> para activar tus 710 productos de inmediato en tu VPS.
              </p>
              <label className="inline-flex items-center gap-2 bg-yellow-400 text-black border-2 border-black font-black uppercase text-xs px-5 py-3 cursor-pointer hover:bg-black hover:text-white transition-all shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5">
                <UploadCloud size={18} />
                <span>📂 Cargar Copia JSON de Productos</span>
                <input 
                  type="file" 
                  accept=".json" 
                  className="hidden" 
                  onChange={handleSubirCopiaJSON}
                />
              </label>
            </div>
          ) : prodFiltrados.length === 0 ? (
            <div className="col-span-full py-12 text-center text-gray-400 font-bold tracking-widest uppercase">
              No se encontraron productos coincidentes con "{busqueda}".
            </div>
          ) : null}
        </div>

        {/* Mobile floating button to open cart */}
        <div className="md:hidden absolute bottom-4 left-4 right-4 z-10">
          <button
            onClick={() => setShowMobileCart(true)}
            className="w-full bg-yellow-400 border-2 border-black p-4 flex justify-between items-center font-black shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_rgba(0,0,0,1)] transition-all"
          >
            <div className="flex items-center gap-2">
              <ShoppingCart size={20} />
              <span>Ver Carrito ({carrito.length})</span>
            </div>
            <span>{formatUSD(totalUSD)}</span>
          </button>
        </div>
      </section>

      {/* Cart View */}
      <aside className={cn(
        "w-full md:w-80 lg:w-96 bg-gray-50 flex flex-col border-l border-gray-200 shrink-0 md:h-full",
        showMobileCart ? "absolute inset-0 z-40 bg-white" : "hidden md:flex"
      )}>
        <div className="p-4 md:p-6 flex-1 flex flex-col h-full overflow-hidden">
          <div className="flex justify-between items-center border-b border-black pb-2 mb-4">
            <h2 className="text-xs font-black uppercase tracking-[0.2em] m-0">Carrito de Venta</h2>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold bg-black text-white px-2 py-0.5 rounded-sm">{carrito.length} Items</span>
              <button onClick={() => setShowMobileCart(false)} className="md:hidden text-black p-1 border-2 border-transparent hover:border-black"><X size={18} /></button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto scroll-hide space-y-4 pr-1">
            {carrito.length === 0 ? (
              <div className="h-full flex items-center justify-center flex-col text-gray-400 opacity-50 space-y-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <p className="font-bold tracking-widest uppercase text-xs">Añade productos</p>
              </div>
            ) : (
              carrito.map((item, idx) => (
                <div key={item.productoId} className={`flex flex-col text-sm ${idx > 0 && 'border-t border-gray-200 pt-3'}`}>
                  <div className="flex justify-between items-start mb-2">
                    <strong className="leading-tight flex-1 pr-2 line-clamp-2">
                      {item.unidad_medida === 'kg' ? `${item.cantidad.toFixed(3)} Kg` : `${item.cantidad}x`} {item.nombre}
                    </strong>
                    <span className="font-black shrink-0">{formatUSD(item.subtotal_usd)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex space-x-1 items-center bg-white border border-gray-200 p-1 rounded-md">
                      {item.unidad_medida !== 'kg' ? (
                        <>
                          <button onClick={() => modificarCantidad(item.productoId, -1)} className="text-xl font-black text-black hover:bg-gray-100 w-8 h-8 flex items-center justify-center rounded">-</button>
                          <span className="font-mono px-2 font-bold select-none">{item.cantidad}</span>
                          <button onClick={() => modificarCantidad(item.productoId, 1)} className="text-xl font-black text-black hover:bg-gray-100 w-8 h-8 flex items-center justify-center rounded">+</button>
                        </>
                      ) : (
                         <button 
                           onClick={() => {
                             const p = productos.find(x => x.id === item.productoId);
                             if(p) {
                               setPesoProducto(p);
                               const whole = Math.floor(item.cantidad);
                               const frac = Math.round((item.cantidad - whole) * 1000);
                               setKilos(whole > 0 ? whole.toString() : '');
                               setGramos(frac > 0 ? frac.toString() : '');
                               setIsEditingWeight(true);
                               setModalPesoOpen(true);
                             }
                           }}
                           className="font-mono text-[10px] px-3 py-1 font-black uppercase tracking-widest bg-yellow-400 hover:bg-black hover:text-white transition-colors"
                         >
                           Editar Peso
                         </button>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-gray-500 font-mono">@ {formatUSD(item.precio_unitario_usd)}</span>
                      <button onClick={() => quitarDelCarrito(item.productoId)} className="text-white bg-red-500 hover:bg-red-600 p-2 rounded-sm transition-colors" title="Quitar">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          
          <div className="mt-4 space-y-2 border-t-2 border-black pt-4 shrink-0 bg-gray-50 pb-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Subtotal (USD)</span>
              <span className="font-bold text-lg">{formatUSD(totalUSD)}</span>
            </div>
            <div className="flex justify-between items-center border-b border-dashed border-gray-300 pb-2 mb-2">
              <span className="text-sm text-gray-600">Impuestos (0%)</span>
              <span className="font-bold">$0.00</span>
            </div>
            
            <div className="flex justify-between items-end pb-2">
              <span className="text-xl font-black">TOTAL</span>
              <div className="text-right">
                <p className="text-3xl font-black leading-none">{formatUSD(totalUSD)}</p>
                <p className="text-xs font-mono text-gray-500 mt-1 uppercase">{formatBs(totalVED).replace('Bs. ', '')} VED</p>
              </div>
            </div>
            
            <button 
              onClick={procesarVenta}
              disabled={carrito.length === 0 || procesando}
              className="w-full bg-yellow-400 py-4 mt-2 border-2 border-black font-black text-lg uppercase tracking-tighter shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_rgba(0,0,0,1)] transition-all disabled:opacity-50 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0"
            >
              {procesando ? 'Procesando...' : 'Registrar Venta'}
            </button>
          </div>
        </div>
      </aside>

      {/* Weight Modal */}
      {modalPesoOpen && pesoProducto && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white border-4 border-black w-full max-w-sm shadow-[8px_8px_0px_rgba(0,0,0,1)] animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="p-4 bg-yellow-400 border-b-4 border-black flex justify-between items-center">
              <h3 className="font-black uppercase text-sm">{pesoProducto.nombre} (Deli)</h3>
              <button onClick={() => setModalPesoOpen(false)}><X size={20} /></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">Kilos</label>
                  <input 
                    type="number" 
                    placeholder="0" 
                    value={kilos} 
                    onChange={e => {
                      setKilos(e.target.value);
                      const k = parseFloat(e.target.value) || 0;
                      const g = parseFloat(gramos) || 0;
                      if (k + g/1000 > pesoProducto.stock) {
                        toast.error("Excede el stock disponible");
                      }
                    }} 
                    className="w-full border-2 border-black p-4 font-mono text-xl" 
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">Gramos</label>
                  <input 
                    type="number" 
                    placeholder="0" 
                    value={gramos} 
                    onChange={e => {
                      setGramos(e.target.value);
                      const k = parseFloat(kilos) || 0;
                      const g = parseFloat(e.target.value) || 0;
                      if (k + g/1000 > pesoProducto.stock) {
                        toast.error("Excede el stock disponible");
                      }
                    }} 
                    className="w-full border-2 border-black p-4 font-mono text-xl" 
                  />
                </div>
              </div>

              <div className="bg-gray-50 border-2 border-dashed border-gray-300 p-4 space-y-2">
                <div className="flex justify-between text-xs font-mono">
                  <span>Precio / Kg:</span>
                  <span className="font-bold">{formatUSD(pesoProducto.precio_usd)}</span>
                </div>
                <div className="flex justify-between text-lg font-black border-t border-gray-200 pt-2">
                  <span>SUBTOTAL:</span>
                  <span>{formatUSD(((parseFloat(kilos)||0) + (parseFloat(gramos)||0)/1000) * pesoProducto.precio_usd)}</span>
                </div>
              </div>

              <button 
                onClick={() => {
                  const totalKg = (parseFloat(kilos) || 0) + (parseFloat(gramos) || 0) / 1000;
                  if (totalKg <= 0) {
                    toast.error("Ingresa un peso válido");
                    return;
                  }
                  if (totalKg > pesoProducto.stock) {
                    toast.error("No hay suficiente en inventario");
                    return;
                  }
                  agregarAlCarrito(pesoProducto, totalKg, isEditingWeight);
                }}
                className="w-full bg-black text-white py-4 font-black uppercase tracking-widest hover:bg-yellow-400 hover:text-black transition-all border-2 border-black"
              >
                {isEditingWeight ? 'Actualizar Peso' : 'Añadir al Carrito'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
