import React, { useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { useConfig } from '../contexts/ConfigContext';
import { Producto, VentaItem, CATEGORIAS_PRODUCTO } from '../types';
import { formatUSD, formatBs, cn } from '../lib/utils';
import BibiStoreLogo from '../components/BibiStoreLogo';
import { ShoppingCart, Search, X, Trash2 } from 'lucide-react';

export default function TiendaPublica() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [carrito, setCarrito] = useState<VentaItem[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [categoriaSel, setCategoriaSel] = useState('Todas');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const { tasaDolar } = useConfig();

  // Modal para peso variable
  const [modalPesoOpen, setModalPesoOpen] = useState(false);
  const [pesoProducto, setPesoProducto] = useState<Producto | null>(null);
  const [kilos, setKilos] = useState('');
  const [gramos, setGramos] = useState('');

  useEffect(() => {
    // Escuchar productos con stock > 0
    const q = query(collection(db, 'productos'), where('stock', '>', 0));
    const unsubscribe = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Producto));
      // Ordenar localmente por nombre
      data.sort((a, b) => a.nombre.localeCompare(b.nombre));
      setProductos(data);
    }, (err) => {
      console.error("Error obteniendo productos:", err);
    });

    return () => unsubscribe();
  }, []);

  const prodFiltrados = productos.filter(p => {
    const matchCat = categoriaSel === 'Todas' || (p.categoria || 'Sin Categoría') === categoriaSel;
    const matchBus = p.nombre.toLowerCase().includes(busqueda.toLowerCase()) || 
                     (p.codigo_barras && p.codigo_barras.includes(busqueda));
    return matchCat && matchBus;
  });

  const agregarAlCarrito = (prod: Producto, weight?: number) => {
    if (prod.unidad_medida === 'kg' && !weight) {
      setPesoProducto(prod);
      setKilos('');
      setGramos('');
      setModalPesoOpen(true);
      return;
    }

    const cantidadAAgregar = weight || 1;

    setCarrito(prev => {
      const ex = prev.find(i => i.productoId === prod.id);
      if (ex) {
        const nuevaCantidad = ex.cantidad + cantidadAAgregar;
        if (nuevaCantidad > prod.stock) {
          alert("No hay suficiente stock");
          return prev;
        }
        return prev.map(i => i.productoId === prod.id ? { ...i, cantidad: nuevaCantidad, subtotal_usd: nuevaCantidad * i.precio_unitario_usd } : i);
      } else {
        if (cantidadAAgregar > prod.stock) {
          alert("No hay suficiente stock");
          return prev;
        }
        return [...prev, {
          productoId: prod.id,
          nombre: prod.nombre,
          cantidad: cantidadAAgregar,
          precio_unitario_usd: prod.precio_usd,
          subtotal_usd: prod.precio_usd * cantidadAAgregar,
          unidad_medida: prod.unidad_medida,
          costo_unitario_usd: 0 // Not needed for public storefront
        }];
      }
    });

    setIsCartOpen(true);
  };

  const removerDelCarrito = (id: string) => {
    setCarrito(prev => prev.filter(i => i.productoId !== id));
  };

  const modificarCantidad = (id: string, delta: number) => {
    setCarrito(prev => prev.map(i => {
      if (i.productoId === id) {
        const prodData = productos.find(p => p.id === id);
        let nuevaCant = i.cantidad + delta;
        if (nuevaCant <= 0) return i; // To remove use delete button
        if (prodData && nuevaCant > prodData.stock) {
          alert("No hay suficiente stock");
          return i;
        }
        return { ...i, cantidad: nuevaCant, subtotal_usd: nuevaCant * i.precio_unitario_usd };
      }
      return i;
    }));
  };

  const totalUSD = carrito.reduce((acc, i) => acc + i.subtotal_usd, 0);
  const totalVED = totalUSD * tasaDolar;

  const handleCheckoutWhatsApp = () => {
    if (carrito.length === 0) return;
    
    let mensaje = "👋 Hola *Bibi Store*, quiero realizar el siguiente pedido:\n\n";
    carrito.forEach((item, index) => {
      mensaje += `*${index + 1}.* ${item.nombre}\n`;
      if (item.unidad_medida === 'kg') {
        mensaje += `   Cantidad: ${item.cantidad.toFixed(3)} Kg\n`;
      } else {
        mensaje += `   Cantidad: ${item.cantidad} u\n`;
      }
      mensaje += `   Precio: ${formatUSD(item.precio_unitario_usd)} c/u\n`;
      mensaje += `   Subtotal: ${formatUSD(item.subtotal_usd)}\n\n`;
    });

    mensaje += `*Total Dólares:* ${formatUSD(totalUSD)}\n`;
    mensaje += `*Total Bolívares:* ${formatBs(totalVED)}\n\n`;
    mensaje += `Por favor indíquenme los métodos de pago disponibles.`;

    const numeroWhatsApp = "584264426488"; // El número sin el 0, asumiendo Venezuela (+58)
    const url = `https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensaje)}`;
    window.open(url, '_blank');
  };

  const categoriasConProductos = ['Todas', ...CATEGORIAS_PRODUCTO, 'Sin Categoría'].filter(cat => 
    cat === 'Todas' || productos.some(p => (p.categoria || 'Sin Categoría') === cat)
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      {/* Navbar */}
      <header className="bg-black text-white p-4 flex justify-between items-center sticky top-0 z-40 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="bg-white p-1 rounded-lg">
            <BibiStoreLogo className="h-10 w-10 sm:h-12 sm:w-12" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tighter leading-none text-white uppercase">
              BIBI STORE
            </h1>
            <p className="text-[10px] sm:text-xs text-gray-400 tracking-wide mt-1 uppercase">Catálogo en línea</p>
          </div>
        </div>
        
        <button 
          onClick={() => setIsCartOpen(true)}
          className="relative bg-yellow-400 text-black p-3 rounded-full hover:bg-white transition-colors"
        >
          <ShoppingCart size={24} />
          {carrito.length > 0 && (
            <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs font-bold rounded-full h-6 w-6 flex items-center justify-center border-2 border-black">
              {carrito.reduce((acc, item) => acc + (item.unidad_medida==='kg'?1:item.cantidad), 0)}
            </span>
          )}
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 max-w-7xl mx-auto w-full flex flex-col gap-6 relative">
        <div className="bg-white p-4 border border-gray-200 rounded-xl shadow-sm flex flex-col sm:flex-row gap-4 items-center">
          <div className="relative w-full flex-1">
            <Search className="absolute left-3 top-3 text-gray-400" size={20} />
            <input 
              type="text" 
              placeholder="Buscar productos..." 
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:border-black focus:outline-none transition-colors"
            />
          </div>
          <select 
            value={categoriaSel} 
            onChange={(e) => setCategoriaSel(e.target.value)}
            className="w-full sm:w-auto p-3 border-2 border-gray-200 rounded-xl focus:border-black focus:outline-none font-bold uppercase tracking-wide bg-gray-50"
          >
            {categoriasConProductos.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-24">
          {prodFiltrados.map(prod => (
            <div 
              key={prod.id} 
              onClick={() => agregarAlCarrito(prod)}
              className="bg-white border-2 border-gray-100 rounded-2xl p-4 transition-all hover:border-black cursor-pointer group flex flex-col shadow-sm hover:shadow-md"
            >
               {prod.imagen_url ? (
                 <div className="h-32 mb-4 bg-gray-50 rounded-xl p-2 flex items-center justify-center">
                   <img src={prod.imagen_url} alt={prod.nombre} className="h-full w-auto object-contain mix-blend-multiply" />
                 </div>
               ) : (
                 <div className="h-32 mb-4 bg-gray-50 rounded-xl p-2 flex items-center justify-center">
                    <span className="text-gray-300 font-bold uppercase tracking-widest text-xs">Sin Imagen</span>
                 </div>
               )}
               
               <div className="flex justify-between items-start mb-1">
                 <span className="text-[10px] bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded font-bold uppercase tracking-tighter truncate max-w-[60%]">
                   {prod.categoria || 'Varios'}
                 </span>
               </div>
               
               <h3 className="font-bold text-sm sm:text-base leading-tight flex-1 mb-2 line-clamp-2">{prod.nombre}</h3>
               
               <div className="mt-auto pt-3 border-t border-gray-100">
                 <div className="flex flex-col">
                    <span className="text-lg sm:text-xl font-black text-black leading-none">
                      {formatUSD(prod.precio_usd)}
                      {prod.unidad_medida === 'kg' && <span className="text-[10px] text-gray-500 uppercase ml-1 font-normal">/ kg</span>}
                    </span>
                    <span className="text-xs font-mono text-gray-500 mt-1">{formatBs(prod.precio_usd * tasaDolar)}</span>
                 </div>
               </div>
               
               <button className="mt-4 w-full bg-black text-white font-bold uppercase tracking-widest text-xs py-2 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity">
                 Añadir
               </button>
            </div>
          ))}
          
          {prodFiltrados.length === 0 && (
            <div className="col-span-full py-12 text-center text-gray-400 font-bold tracking-widest uppercase">
              No se encontraron productos
            </div>
          )}
        </div>
      </main>

      {/* Cart Drawer */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setIsCartOpen(false)} />
          <div className="w-full max-w-md bg-white h-full relative z-10 flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
            <div className="p-6 bg-black text-white flex justify-between items-center">
              <h2 className="text-2xl font-black uppercase tracking-widest flex items-center gap-3">
                <ShoppingCart /> Tu Carrito
              </h2>
              <button onClick={() => setIsCartOpen(false)} className="text-gray-400 hover:text-white transition-colors">
                <X size={28} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {carrito.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400">
                  <ShoppingCart size={64} className="mb-4 text-gray-200" />
                  <p className="font-bold uppercase tracking-widest">El carrito está vacío</p>
                </div>
              ) : (
                carrito.map((item) => (
                  <div key={item.productoId} className="flex flex-col p-4 border-2 border-gray-100 rounded-xl">
                    <div className="flex justify-between items-start mb-2">
                       <h3 className="font-bold leading-tight flex-1 pr-2">{item.nombre}</h3>
                       <button onClick={() => removerDelCarrito(item.productoId)} className="text-red-500 hover:text-red-700 bg-red-50 p-2 rounded-lg transition-colors">
                         <Trash2 size={18} />
                       </button>
                    </div>
                    <div className="flex justify-between items-end mt-2">
                      <div className="flex flex-col">
                        <span className="font-bold">{formatUSD(item.subtotal_usd)}</span>
                        <span className="text-xs font-mono text-gray-500">{formatBs(item.subtotal_usd * tasaDolar)}</span>
                      </div>
                      
                      <div className="flex items-center gap-3 bg-gray-100 p-1 rounded-lg">
                        {item.unidad_medida !== 'kg' ? (
                          <>
                            <button onClick={() => modificarCantidad(item.productoId, -1)} className="w-8 h-8 flex items-center justify-center bg-white rounded font-black hover:text-red-600 transition-colors shadow-sm">-</button>
                            <span className="font-bold font-mono min-w-[20px] text-center">{item.cantidad}</span>
                            <button onClick={() => modificarCantidad(item.productoId, 1)} className="w-8 h-8 flex items-center justify-center bg-white rounded font-black hover:text-green-600 transition-colors shadow-sm">+</button>
                          </>
                        ) : (
                          <span className="font-mono text-xs px-3 font-bold bg-white leading-8 rounded">{item.cantidad.toFixed(3)} Kg</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            {carrito.length > 0 && (
              <div className="p-6 bg-gray-50 border-t-2 border-gray-200">
                <div className="flex justify-between items-end mb-6">
                  <span className="font-black uppercase tracking-widest text-gray-500">Total</span>
                  <div className="text-right">
                    <div className="text-3xl font-black text-black">{formatUSD(totalUSD)}</div>
                    <div className="text-sm font-mono text-gray-500">{formatBs(totalVED)}</div>
                  </div>
                </div>
                <button 
                  onClick={handleCheckoutWhatsApp}
                  className="w-full bg-[#25D366] text-white py-4 rounded-xl font-black uppercase tracking-widest text-lg hover:bg-[#128C7E] transition-colors shadow-lg flex items-center justify-center gap-3"
                >
                  <ShoppingCart size={24} /> Enviar Pedido
                </button>
                <p className="text-[10px] text-center text-gray-500 uppercase font-bold tracking-widest mt-4">
                  Serás redirigido a WhatsApp
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Peso Fijo */}
      {modalPesoOpen && pesoProducto && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border-4 border-black p-6 w-full max-w-sm relative">
            <button onClick={() => setModalPesoOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-black">
              <X />
            </button>
            <h2 className="text-2xl font-black uppercase tracking-widest mb-2 border-b-4 border-black pb-4 text-black">
              Peso del Producto
            </h2>
            <p className="text-sm font-bold text-gray-500 mb-6 uppercase tracking-widest">
              {pesoProducto.nombre}
            </p>
            
            <div className="flex items-center gap-4 mb-6">
              <div className="flex-1">
                <label className="block text-xs font-black uppercase tracking-widest mb-2">Kilos</label>
                <input 
                  type="number" 
                  min="0"
                  value={kilos}
                  onChange={e => setKilos(e.target.value)}
                  className="w-full border-2 border-black p-4 text-center text-2xl font-black focus:outline-none focus:ring-4 focus:ring-yellow-400 transition-shadow"
                  placeholder="0"
                />
              </div>
              <span className="text-4xl font-black text-gray-300">.</span>
              <div className="flex-1">
                <label className="block text-xs font-black uppercase tracking-widest mb-2">Gramos</label>
                <input 
                  type="number" 
                  min="0"
                  max="999"
                  value={gramos}
                  onChange={e => setGramos(e.target.value.slice(0,3))}
                  className="w-full border-2 border-black p-4 text-center text-2xl font-black focus:outline-none focus:ring-4 focus:ring-yellow-400 transition-shadow"
                  placeholder="000"
                />
              </div>
            </div>
            
            <div className="flex gap-2">
              <button 
                onClick={() => setModalPesoOpen(false)}
                className="flex-1 bg-gray-200 text-black py-4 font-black uppercase tracking-widest hover:bg-gray-300 transition-colors border-2 border-transparent"
              >
                Cancelar
              </button>
              <button 
                onClick={() => {
                  const k = parseInt(kilos || '0');
                  const g = parseInt(gramos || '0');
                  const totalKg = k + (g / 1000);
                  if (totalKg <= 0) {
                    alert("Ingrese un peso válido");
                    return;
                  }
                  if (totalKg > pesoProducto.stock) {
                    alert("No hay suficiente en inventario");
                    return;
                  }
                  agregarAlCarrito(pesoProducto, totalKg);
                  setModalPesoOpen(false);
                }}
                className="flex-1 bg-black text-white py-4 font-black uppercase tracking-widest hover:bg-yellow-400 hover:text-black transition-all border-2 border-black"
              >
                Añadir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
