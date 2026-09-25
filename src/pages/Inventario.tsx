import React, { useState, useEffect } from 'react';
import { db, storage } from '../lib/firebase';
import { collection, onSnapshot, doc, deleteDoc, writeBatch, query, limit, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '../contexts/AuthContext';
import { useConfig } from '../contexts/ConfigContext';
import { Producto, CATEGORIAS_PRODUCTO } from '../types';
import { formatUSD, formatBs, cn } from '../lib/utils';
import { Plus, Edit2, Trash2, Search, X, Scan, Filter, FileDown, FileCode, Package, UploadCloud } from 'lucide-react';
import Scanner from '../components/Scanner';
import toast from 'react-hot-toast';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { exportarProductosJSON, descargarJSON } from '../lib/exportProductos';
import { getVPSProductos, saveVPSProducto, deleteVPSProducto, migrarTodoAVPS } from '../lib/vpsService';

export default function Inventario() {
  const { role } = useAuth();
  const { tasaDolar } = useConfig();
  const [productos, setProductos] = useState<(Producto & { costo_usd?: number })[]>(() => {
    try {
      const saved = localStorage.getItem('bibi_store_cached_productos');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [cargando, setCargando] = useState(productos.length === 0);
  const [busqueda, setBusqueda] = useState('');
  
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [scannerAbierto, setScannerAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  
  // Form state
  const [nombre, setNombre] = useState('');
  const [precio, setPrecio] = useState('');
  const [costo, setCosto] = useState('');
  const [margen, setMargen] = useState('');
  const [stock, setStock] = useState('');
  const [unidadMedida, setUnidadMedida] = useState<'unid' | 'kg'>('unid');
  const [categoria, setCategoria] = useState('');
  const [codigo, setCodigo] = useState('');
  const [imagenUrl, setImagenUrl] = useState('');
  const [imagenArchivo, setImagenArchivo] = useState<File | null>(null);

  const isAdmin = role === 'admin' || role === 'superadmin';

  const handleCostoChange = (val: string) => {
    setCosto(val);
    const c = parseFloat(val);
    const m = parseFloat(margen);
    if (!isNaN(c) && !isNaN(m)) {
      setPrecio((c + (c * m / 100)).toFixed(2));
    }
  };

  const handleMargenChange = (val: string) => {
    setMargen(val);
    const m = parseFloat(val);
    const c = parseFloat(costo);
    if (!isNaN(m) && !isNaN(c)) {
      setPrecio((c + (c * m / 100)).toFixed(2));
    }
  };

  const handlePrecioChange = (val: string) => {
    setPrecio(val);
    const p = parseFloat(val);
    const c = parseFloat(costo);
    if (!isNaN(p) && !isNaN(c) && c > 0) {
      setMargen((((p - c) / c) * 100).toFixed(2));
    } else {
      setMargen('');
    }
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 600;
        const MAX_HEIGHT = 600;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob((blob) => {
          if(blob) {
            const compressedFile = new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() });
            setImagenArchivo(compressedFile);
            setImagenUrl(canvas.toDataURL('image/jpeg', 0.8));
          }
        }, 'image/jpeg', 0.8);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    // 1. Cargar inmediatamente desde la VPS si está disponible
    getVPSProductos().then(vpsProds => {
      if (vpsProds && Array.isArray(vpsProds) && vpsProds.length > 0) {
        setProductos(prev => prev.length === 0 ? vpsProds : prev);
        setCargando(false);
      }
    }).catch(() => {});

    // 2. Escuchar productos en Firestore de forma directa y limpia
    let unsubCost: (() => void) | undefined;
    const q = query(collection(db, 'productos'));
    const unsubProd = onSnapshot(q, (snap) => {
      const prodData = snap.docs.map(d => ({ id: d.id, ...d.data() } as Producto));
      if (prodData.length > 0) {
        setProductos(prodData);
        try {
          localStorage.setItem('bibi_store_cached_productos', JSON.stringify(prodData));
        } catch {}
      }
      setCargando(false);

      if (isAdmin) {
        if (unsubCost) unsubCost();
        unsubCost = onSnapshot(collection(db, 'costos_productos'), (snapCost) => {
          const costData: Record<string, number> = {};
          snapCost.forEach(d => { costData[d.id] = d.data().costo_usd; });
          setProductos(prev => prev.map(p => ({ ...p, costo_usd: costData[p.id] ?? (p.costo_usd || 0) })));
        }, (errCost) => {
          console.warn("No se pudieron cargar costos de productos:", errCost);
        });
      }
    }, (err) => {
      console.warn("Firestore productos aviso:", err.message);
      setCargando(false);
    });

    return () => {
      unsubProd();
      if (unsubCost) unsubCost();
    };
  }, [isAdmin]);

  const handleSubirCopiaJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const toastId = toast.loading("Restaurando catálogo desde copia JSON...");
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
        throw new Error("El archivo no contiene productos.");
      }

      setProductos(prods);
      try {
        localStorage.setItem('bibi_store_cached_productos', JSON.stringify(prods));
      } catch {}

      try {
        await migrarTodoAVPS({ productos: prods });
      } catch (e) {
        console.warn("Aviso guardando en VPS:", e);
      }

      toast.success(`🎉 ¡Éxito! ${prods.length} productos cargados y respaldados en la VPS.`, { id: toastId, duration: 6000 });
      setCargando(false);
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

  const abrirModal = (prod?: Producto & { costo_usd?: number }) => {
    setImagenArchivo(null);
    if (prod) {
      setEditandoId(prod.id);
      setNombre(prod.nombre);
      setPrecio(prod.precio_usd.toString());
      setCosto(prod.costo_usd?.toString() || '');
      setStock(prod.stock.toString());
      setUnidadMedida(prod.unidad_medida || 'unid');
      setCategoria(prod.categoria || '');
      setCodigo(prod.codigo_barras);
      setImagenUrl(prod.imagen_url || '');

      if (prod.costo_usd && prod.costo_usd > 0) {
        setMargen((((prod.precio_usd - prod.costo_usd) / prod.costo_usd) * 100).toFixed(2));
      } else {
        setMargen('');
      }
    } else {
      setEditandoId(null);
      setNombre('');
      setPrecio('');
      setCosto('');
      setStock('');
      setUnidadMedida('unid');
      setCategoria('');
      setCodigo('');
      setImagenUrl('');
      setMargen('');
    }
    setModalAbierto(true);
  };

  const guardarProducto = async (e: React.FormEvent) => {
    e.preventDefault();
    const loadingToast = toast.loading("Guardando producto...");
    setGuardando(true);
    
    try {
      const targetId = editandoId || `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const prodCompleto: Producto & { costo_usd?: number } = {
        id: targetId,
        nombre: nombre.trim(),
        precio_usd: Number(precio) || 0,
        costo_usd: Number(costo) || 0,
        stock: Number(stock) || 0,
        unidad_medida: unidadMedida,
        categoria: categoria || 'Sin Categoría',
        codigo_barras: (codigo || "N/A").trim(),
        imagen_url: imagenUrl || ""
      };

      // 1. Guardar en el motor backend de la VPS
      await saveVPSProducto(prodCompleto);

      // 2. Actualizar estado local y cache inmediatamente
      setProductos(prev => {
        const idx = prev.findIndex(p => p.id === targetId);
        let updated: any[];
        if (idx >= 0) {
          updated = [...prev];
          updated[idx] = { ...updated[idx], ...prodCompleto };
        } else {
          updated = [prodCompleto, ...prev];
        }
        try {
          localStorage.setItem('bibi_store_cached_productos', JSON.stringify(updated));
        } catch {}
        return updated;
      });

      // 3. Sincronizar en segundo plano con Firestore (si está accesible)
      try {
        const batch = writeBatch(db);
        const prodRef = doc(db, 'productos', targetId);
        batch.set(prodRef, {
          nombre: prodCompleto.nombre,
          precio_usd: prodCompleto.precio_usd,
          stock: prodCompleto.stock,
          unidad_medida: prodCompleto.unidad_medida,
          categoria: prodCompleto.categoria,
          codigo_barras: prodCompleto.codigo_barras,
          imagen_url: prodCompleto.imagen_url
        }, { merge: true });

        if (isAdmin) {
          const costoRef = doc(db, 'costos_productos', targetId);
          batch.set(costoRef, { costo_usd: prodCompleto.costo_usd }, { merge: true });
        }
        await batch.commit();
      } catch (errSync) {
        console.warn("Sincronización en segundo plano con Firestore omitida:", errSync);
      }
      
      toast.success(editandoId ? "Producto actualizado correctamente" : "Producto añadido con éxito", { id: loadingToast, duration: 2500 });
      setModalAbierto(false);
    } catch (err) {
      console.error("Error detallado al guardar:", err);
      toast.error("Error al guardar producto en el servidor.", { id: loadingToast, duration: 4000 });
    } finally {
      setGuardando(false);
    }
  };

  const eliminarProducto = async (id: string) => {
    if(!confirm("¿Seguro que desea eliminar este producto?")) return;
    try {
      // 1. Eliminar en VPS
      await deleteVPSProducto(id);

      // 2. Eliminar del estado local
      setProductos(prev => {
        const filtered = prev.filter(p => p.id !== id);
        try {
          localStorage.setItem('bibi_store_cached_productos', JSON.stringify(filtered));
        } catch {}
        return filtered;
      });

      // 3. Eliminar de Firestore en segundo plano
      try {
        if (isAdmin) {
          await deleteDoc(doc(db, 'costos_productos', id));
        }
        await deleteDoc(doc(db, 'productos', id));
      } catch {}

      toast.success("Producto eliminado del inventario");
    } catch (err) {
      toast.error("Error al eliminar producto");
    }
  };

  const descargarCatalogo = async () => {
    const loadingToast = toast.loading("Generando catálogo...");
    try {
      let allProductos = productos;
      if (!allProductos || allProductos.length === 0) {
        allProductos = await getVPSProductos();
      }

      const doc = new jsPDF();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text('LISTAS DE PRECIOS', 105, 15, { align: 'center' });
      
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Generado el: ${new Date().toLocaleDateString()}  -  Tasa: ${formatBs(tasaDolar)}`, 105, 20, { align: 'center' });

      const categorias = Array.from(new Set(allProductos.map(p => p.categoria || 'Sin Categoría'))).sort();
      
      // Prepare data elements
      const elements: any[] = [];
      categorias.forEach(cat => {
        const prodsCat = allProductos.filter(p => (p.categoria || 'Sin Categoría') === cat).sort((a,b) => a.nombre.localeCompare(b.nombre));
        if (prodsCat.length === 0) return;
        
        elements.push({ isCategory: true, text: cat });
        prodsCat.forEach(p => {
          elements.push({ 
            isCategory: false, 
            name: p.nombre, 
            price: `${formatUSD(p.precio_usd)} / ${formatBs(p.precio_usd * tasaDolar)}`.replace('Bs. ', 'Bs ')
          });
        });
      });

      // Split into two columns
      const half = Math.ceil(elements.length / 2);
      const leftElements = elements.slice(0, half);
      const rightElements = elements.slice(half);

      const body = [];
      const maxLen = Math.max(leftElements.length, rightElements.length);

      for (let i = 0; i < maxLen; i++) {
        const l = leftElements[i];
        const r = rightElements[i];
        
        const row = [];
        
        if (l) {
          if (l.isCategory) {
            row.push({ 
              content: l.text, 
              colSpan: 2, 
              styles: { fontStyle: 'italic', textColor: [0,0,0], fillColor: [245,245,245], halign: 'center', fontSize: 11, cellPadding: 2, font: 'helvetica' } 
            });
          } else {
            row.push({ content: l.name, styles: { fontSize: 9 } });
            row.push({ content: l.price, styles: { fontSize: 9 } });
          }
        } else {
          row.push({ content: '' });
          row.push({ content: '' });
        }

        if (r) {
          if (r.isCategory) {
            row.push({ 
              content: r.text, 
              colSpan: 2, 
              styles: { fontStyle: 'italic', textColor: [0,0,0], fillColor: [245,245,245], halign: 'center', fontSize: 11, cellPadding: 2, font: 'helvetica' } 
            });
          } else {
            row.push({ content: r.name, styles: { fontSize: 9 } });
            row.push({ content: r.price, styles: { fontSize: 9 } });
          }
        } else {
          row.push({ content: '' });
          row.push({ content: '' });
        }

        body.push(row);
      }

      autoTable(doc, {
        startY: 25,
        head: [['Producto', 'Precio', 'Producto', 'Precio']],
        body: body,
        theme: 'grid',
        headStyles: { 
          fillColor: [255, 255, 255], 
          textColor: [0, 0, 0], 
          lineColor: [0, 0, 0], 
          lineWidth: 0.1,
          halign: 'center',
          fontStyle: 'bold'
        },
        styles: { 
          lineColor: [0, 0, 0], 
          lineWidth: 0.1,
          textColor: [0, 0, 0],
          cellPadding: 1.5,
          font: 'helvetica'
        },
        columnStyles: {
          0: { cellWidth: 50 },
          1: { cellWidth: 40 },
          2: { cellWidth: 50 },
          3: { cellWidth: 40 }
        },
        margin: { left: 15, right: 15 }
      });

      doc.save('Listas_de_Precios.pdf');
      toast.success("Catálogo generado correctamente", { id: loadingToast });
    } catch (err) {
      console.error(err);
      toast.error("Error al generar catálogo", { id: loadingToast });
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header and Search */}
      <div className="p-4 md:p-6 border-b border-black flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 bg-gray-50/50">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-widest flex items-center gap-2">
            Catálogo
          </h1>
          <p className="text-[10px] font-mono uppercase text-gray-400 mt-1">{productos.length} Productos Registrados</p>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <label 
            className="bg-yellow-400 text-black border-2 border-black px-3 py-2 font-bold uppercase tracking-wider text-xs hover:bg-black hover:text-white transition-all flex items-center gap-2 whitespace-nowrap shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
            title="Restaurar catálogo desde copia de seguridad JSON"
          >
            <UploadCloud size={16} /> <span className="hidden sm:inline">Restaurar JSON</span>
            <input 
              type="file" 
              accept=".json" 
              className="hidden" 
              onChange={handleSubirCopiaJSON}
            />
          </label>
          <button 
            onClick={async () => {
              const loadingToast = toast.loading("Exportando catálogo completo con fotos y costos...");
              try {
                const data = await exportarProductosJSON(productos);
                descargarJSON(data, 'bibi_store_productos_completos.json');
                console.log("EXPORTED PRODUCTOS JSON:", data);
                toast.success(`¡Descargados ${data.length} productos con fotos y costos!`, { id: loadingToast, duration: 5000 });
              } catch (err) {
                console.error(err);
                toast.error("Error al exportar productos", { id: loadingToast });
              }
            }}
            className="bg-emerald-600 text-white border-2 border-black px-3 py-2 font-bold uppercase tracking-wider text-xs hover:bg-black hover:text-white transition-all flex items-center gap-2 whitespace-nowrap shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            title="Descargar copia completa (710 productos con fotos y costos)"
          >
            <FileCode size={16} /> <span className="hidden sm:inline">Descargar Copia</span>
          </button>
          <button 
            onClick={descargarCatalogo}
            className="bg-black text-white border-2 border-black px-3 py-2 font-bold uppercase tracking-wider text-xs hover:bg-yellow-400 hover:text-black transition-all flex items-center gap-2 whitespace-nowrap shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            title="Descargar Catálogo PDF"
          >
            <FileDown size={16} /> <span className="hidden sm:inline">PDF</span>
          </button>
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input 
              type="text" 
              placeholder="Buscar por nombre o barras..." 
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border-2 border-black rounded-none focus:outline-none focus:border-yellow-500 font-mono text-xs uppercase"
            />
          </div>
          {(isAdmin || role === 'cajero') && (
            <button 
              onClick={() => abrirModal()}
              className="bg-yellow-400 text-black border-2 border-black px-4 py-2 font-bold uppercase tracking-wider text-xs hover:bg-black hover:text-white transition-all flex items-center gap-2"
            >
              <Plus size={16} /> <span className="hidden sm:inline">Nuevo</span>
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-white">
        {cargando && productos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-yellow-400 mb-3"></div>
            <p className="font-mono text-xs uppercase tracking-widest font-black text-gray-500">Cargando Catálogo de Productos...</p>
          </div>
        ) : !cargando && productos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center border-2 border-dashed border-black bg-yellow-50/50 my-6">
            <Package size={48} className="text-black mb-3" />
            <h3 className="font-black text-base uppercase tracking-wider text-black">Catálogo sin productos cargados</h3>
            <p className="text-xs text-gray-600 max-w-md mt-1 mb-5 font-medium leading-relaxed">
              El límite de lecturas de Firebase está activo. Carga tu copia de seguridad <b>bibi_store_productos_completos.json</b> para activar tus 710 productos de inmediato en tu VPS y en esta pantalla.
            </p>
            <label className="inline-flex items-center gap-2 bg-yellow-400 text-black border-2 border-black font-black uppercase text-xs px-5 py-3 cursor-pointer hover:bg-black hover:text-white transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5">
              <UploadCloud size={18} />
              <span>📂 Cargar Archivo JSON de Copia de Seguridad</span>
              <input 
                type="file" 
                accept=".json" 
                className="hidden" 
                onChange={handleSubirCopiaJSON}
              />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6 pb-20">
            {prodFiltrados.map(prod => (
              <div key={prod.id} className="bg-white border-2 border-black group flex flex-col p-3 md:p-5 hover:shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all relative">
                {/* Product Image Fallback or Display */}
                <div className="h-24 md:h-32 mb-3 bg-gray-50 flex items-center justify-center border border-gray-100 overflow-hidden relative">
                  {prod.imagen_url ? (
                    <img src={prod.imagen_url} alt={prod.nombre} className="h-full w-full object-contain mix-blend-multiply" />
                  ) : (
                    <span className="text-[8px] font-black text-gray-300 uppercase tracking-widest">Sin Imagen</span>
                  )}
                  {/* Stock Badge Overlay */}
                  <div className={cn(
                    "absolute bottom-0 right-0 px-2 py-0.5 text-[8px] font-black uppercase tracking-tighter border-l border-t border-black transition-colors",
                    prod.stock <= 5 ? "bg-red-500 text-white animate-pulse" : "bg-black text-white"
                  )}>
                    {prod.unidad_medida === 'kg' ? `Stock: ${prod.stock.toFixed(3)} Kg` : `Stock: ${prod.stock}`}
                  </div>
                </div>

                {/* Info Area */}
                <div className="flex flex-col flex-1">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[8px] font-bold text-gray-400 uppercase tracking-widest truncate max-w-[70%]">{prod.codigo_barras || 'N/A'}</span>
                    <div className="flex gap-2">
                      {(isAdmin || role === 'cajero') && (
                        <button onClick={() => abrirModal(prod)} className="text-gray-400 hover:text-black transition-colors"><Edit2 size={12} /></button>
                      )}
                      {isAdmin && (
                        <button onClick={() => eliminarProducto(prod.id)} className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={12} /></button>
                      )}
                    </div>
                  </div>
                  <h3 className="font-extrabold text-sm md:text-base leading-tight mb-2 line-clamp-2 min-h-[2.5rem]">{prod.nombre}</h3>
                  
                  <div className="mt-auto border-t border-dashed border-gray-200 pt-3 flex flex-col space-y-1">
                    <div className="flex justify-between items-end">
                      <span className="text-lg md:text-xl font-black text-black">
                        {formatUSD(prod.precio_usd)}
                        <span className="text-[10px] ml-1 font-normal text-gray-500 uppercase">{prod.unidad_medida === 'kg' ? '/ Kg' : '/ Und'}</span>
                      </span>
                      {isAdmin && prod.costo_usd && (
                        <span className="text-[8px] font-black text-orange-400 uppercase tracking-tighter">C: {formatUSD(prod.costo_usd)}</span>
                      )}
                    </div>
                    <span className="text-[10px] md:text-xs font-mono font-bold text-gray-400 bg-gray-50 px-2 py-0.5 border border-gray-100 self-start">
                      {formatBs(prod.precio_usd * tasaDolar)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {prodFiltrados.length === 0 && (
              <div className="col-span-full py-16 text-center font-bold text-gray-400 uppercase tracking-widest text-xs flex flex-col items-center gap-2">
                <Package size={36} className="text-gray-300" />
                <span>{busqueda ? `No se encontraron productos para "${busqueda}"` : "Catálogo Vacío"}</span>
                {isAdmin && !busqueda && (
                  <button 
                    onClick={() => abrirModal()}
                    className="mt-2 bg-yellow-400 text-black border-2 border-black px-4 py-2 font-black uppercase text-xs hover:bg-black hover:text-white transition-all cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  >
                    + Agregar Primer Producto
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {modalAbierto && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
          {scannerAbierto && (
            <Scanner 
              onScan={(code) => setCodigo(code)} 
              onClose={() => setScannerAbierto(false)} 
              title="Inventario: Capturar Código" 
            />
          )}
          <div className="bg-white border-4 border-black w-full max-w-lg shadow-[8px_8px_0px_rgba(0,0,0,1)] relative flex flex-col max-h-[95vh] animate-in zoom-in-95 duration-200">
            <button 
              onClick={() => setModalAbierto(false)}
              className="absolute top-4 right-4 text-black hover:text-red-600 transition-colors z-10"
            >
              <X size={24} />
            </button>
            <div className="p-4 md:p-6 border-b-2 border-black bg-yellow-400">
              <h2 className="text-xl font-black uppercase tracking-widest mr-8">{editandoId ? 'Editar Producto' : 'Crear Producto'}</h2>
            </div>
            
            <form onSubmit={guardarProducto} className="p-4 md:p-6 overflow-y-auto space-y-5">
              <div className="space-y-4">
                <div className="flex items-center justify-center border-2 border-dashed border-gray-300 p-4 bg-gray-50 relative min-h-32">
                  {imagenUrl ? (
                    <div className="relative group">
                       <img src={imagenUrl} alt="Preview" className="h-32 w-auto object-contain" />
                       <button type="button" onClick={() => setImagenUrl('')} className="absolute top-0 right-0 bg-red-500 text-white rounded-full p-1 translate-x-1/2 -translate-y-1/2 shadow-lg">
                         <X size={14} />
                       </button>
                    </div>
                  ) : (
                    <div className="text-center">
                      <button type="button" onClick={() => fileInputRef.current?.click()} className="text-[10px] font-black uppercase tracking-widest hover:text-black text-gray-400 border-2 border-gray-200 px-4 py-2 hover:border-black transition-all">Añadir Foto del Producto</button>
                    </div>
                  )}
                  <input 
                    type="file" 
                    accept="image/*" 
                    capture="environment"
                    ref={fileInputRef}
                    onChange={handlePhotoUpload}
                    className="hidden" 
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Tipo de Venta / Unidad</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      type="button" 
                      onClick={() => setUnidadMedida('unid')}
                      className={cn(
                        "py-3 font-black uppercase text-[10px] tracking-widest border-2 border-black transition-all",
                        unidadMedida === 'unid' ? "bg-black text-white" : "bg-white text-black hover:bg-gray-100"
                      )}
                    >
                      Por Unidades
                    </button>
                    <button 
                      type="button" 
                      onClick={() => setUnidadMedida('kg')}
                      className={cn(
                        "py-3 font-black uppercase text-[10px] tracking-widest border-2 border-black transition-all",
                        unidadMedida === 'kg' ? "bg-black text-white" : "bg-white text-black hover:bg-gray-100"
                      )}
                    >
                      Deli / Kg
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Categoría</label>
                  <select 
                    value={categoria} 
                    onChange={e => setCategoria(e.target.value)}
                    required
                    className="w-full border-2 border-black p-3 font-bold text-sm bg-white"
                  >
                    <option value="" disabled>Seleccione una categoría...</option>
                    {CATEGORIAS_PRODUCTO.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Nombre del Producto</label>
                  <input required type="text" value={nombre} onChange={e=>setNombre(e.target.value)} className="w-full border-2 border-black p-3 font-bold text-sm" />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Referencia / Código</label>
                  <div className="flex gap-2">
                    <input type="text" value={codigo || ''} onChange={e=>setCodigo(e.target.value)} className="flex-1 border-2 border-black p-3 font-mono text-sm uppercase" placeholder="Escanea o escribe..." />
                    <button 
                      type="button"
                      onClick={() => setScannerAbierto(true)}
                      className="bg-black text-white px-4 border-2 border-black hover:bg-yellow-400 hover:text-black transition-all flex items-center justify-center"
                      title="Escanear con Cámara"
                    >
                      <Scan size={18} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[8px] font-black uppercase tracking-widest mb-1 text-orange-600">
                      {unidadMedida === 'kg' ? 'Costo por Kg' : 'Costo Unitario'} (USD)
                    </label>
                    <input required type="number" step="0.01" min="0" value={costo} onChange={e=>handleCostoChange(e.target.value)} disabled={!isAdmin && !!editandoId} className="w-full border-2 border-orange-500 p-3 font-mono font-bold bg-orange-50 text-sm disabled:opacity-50" />
                  </div>
                  <div>
                    <label className="block text-[8px] font-black uppercase tracking-widest mb-1 text-blue-600">Margen %</label>
                    <input type="number" step="0.01" value={margen} onChange={e=>handleMargenChange(e.target.value)} disabled={!isAdmin && !!editandoId} className="w-full border-2 border-blue-500 p-3 font-mono font-bold bg-blue-50 text-sm disabled:opacity-50" placeholder="GAN" />
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label className="block text-[8px] font-black uppercase tracking-widest mb-1 text-green-600">
                      {unidadMedida === 'kg' ? 'Precio por Kg' : 'Precio Unitario'} (USD)
                    </label>
                    <input required type="number" step="0.01" min="0" value={precio} onChange={e=>handlePrecioChange(e.target.value)} disabled={!isAdmin && !!editandoId} className="w-full border-2 border-green-500 p-3 font-mono font-bold bg-green-50 text-sm disabled:opacity-50" />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-1">
                    {unidadMedida === 'kg' ? 'Stock actual (Kilos)' : 'Stock actual (Unid)'}
                  </label>
                  <input required type="number" step={unidadMedida === 'kg' ? "0.001" : "1"} min="0" value={stock} onChange={e=>setStock(e.target.value)} className="w-full border-2 border-black p-3 font-mono font-bold text-sm" />
                </div>
              </div>

              <div className="pt-4 flex gap-2">
                <button type="button" onClick={() => setModalAbierto(false)} disabled={guardando} className="flex-1 p-4 font-black uppercase tracking-widest hover:bg-gray-100 border-2 border-black text-xs disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={guardando} className="flex-1 p-4 font-black bg-yellow-400 text-black uppercase tracking-widest hover:bg-black hover:text-white transition-all border-2 border-black text-xs disabled:opacity-50 flex items-center justify-center gap-2">
                  {guardando ? (
                    <>
                      <div className="animate-spin h-4 w-4 border-2 border-black border-t-transparent rounded-full" />
                      Espere...
                    </>
                  ) : 'Confirmar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
