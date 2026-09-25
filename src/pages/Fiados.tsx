import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { collection, onSnapshot, addDoc, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { Fiado } from '../types';
import { formatUSD, formatBs, cn } from '../lib/utils';
import { Plus, Check, Search, X, Users, CreditCard, History, ChevronDown, ChevronUp } from 'lucide-react';
import { useConfig } from '../contexts/ConfigContext';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { getVPSFiados, saveVPSFiado } from '../lib/vpsService';

export default function Fiados() {
  const { role } = useAuth();
  const { tasaDolar } = useConfig();
  const [fiados, setFiados] = useState<Fiado[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [expandedHistorial, setExpandedHistorial] = useState<string | null>(null);
  
  const [modalAbierto, setModalAbierto] = useState(false);
  const [cliente, setCliente] = useState('');
  const [montoUSD, setMontoUSD] = useState('');
  const [descripcion, setDescripcion] = useState('');

  const [modalAbono, setModalAbono] = useState<{abierto: boolean, fiadoId: string, cliente: string, deuda: number}>({
    abierto: false,
    fiadoId: '',
    cliente: '',
    deuda: 0
  });
  const [montoAbono, setMontoAbono] = useState('');

  useEffect(() => {
    // 1. Cargar desde la VPS
    getVPSFiados().then(vpsFiados => {
      if (vpsFiados && Array.isArray(vpsFiados) && vpsFiados.length > 0) {
        setFiados(vpsFiados.sort((a,b) => b.fecha - a.fecha));
      }
    }).catch(e => console.warn("VPS fiados load:", e));

    // 2. Escuchar Firestore si está disponible
    let unsub = () => {};
    try {
      unsub = onSnapshot(collection(db, 'fiados'), (snap) => {
        if (!snap.empty) {
          const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Fiado));
          setFiados(data.sort((a,b) => b.fecha - a.fecha));
        }
      }, (err) => {
        console.warn("Firestore fiados aviso:", err.message);
      });
    } catch {}
    return () => unsub();
  }, []);

  const fiadosFiltrados = fiados.filter(f => f.cliente.toLowerCase().includes(busqueda.toLowerCase()));
  const totalPendiente = fiados.filter(f => f.estado === 'pendiente').reduce((acc, curr) => acc + curr.monto_usd, 0);

  if (role === 'cajero') {
    return (
      <div className="flex flex-col h-full bg-white border-2 border-black max-w-5xl mx-auto w-full items-center justify-center p-6 text-center">
        <Users className="text-gray-300 mb-4" size={64} />
        <h2 className="text-2xl font-black uppercase tracking-widest mb-2">Acceso Restringido</h2>
        <p className="text-sm font-mono text-gray-500 uppercase tracking-widest">No tienes permisos para acceder a los fiados.</p>
      </div>
    );
  }

  const guardarFiado = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const existing = fiados.find(f => f.cliente.toLowerCase() === cliente.trim().toLowerCase() && f.estado === 'pendiente');
      
      const nuevoMonto = existing ? existing.monto_usd + Number(montoUSD) : Number(montoUSD);
      const nuevaDesc = existing 
        ? (existing.descripcion ? `${existing.descripcion}, ${descripcion}` : descripcion)
        : descripcion;
      const targetId = existing ? existing.id : `fiado_${Date.now()}`;

      const fiadoObj: Fiado = {
        id: targetId,
        cliente: cliente.trim().toUpperCase(),
        monto_usd: nuevoMonto,
        descripcion: nuevaDesc,
        fecha: Date.now(),
        estado: 'pendiente',
        historial_abonos: existing?.historial_abonos || []
      };

      // 1. Guardar en VPS
      await saveVPSFiado(fiadoObj);

      // 2. Actualizar estado local
      setFiados(prev => {
        const filtered = prev.filter(f => f.id !== targetId);
        return [fiadoObj, ...filtered].sort((a,b) => b.fecha - a.fecha);
      });

      // 3. Sincronizar con Firestore en segundo plano
      try {
        if (existing) {
          await updateDoc(doc(db, 'fiados', existing.id), {
            monto_usd: nuevoMonto,
            descripcion: nuevaDesc,
            fecha: Date.now()
          });
        } else {
          await addDoc(collection(db, 'fiados'), {
            cliente: cliente.trim().toUpperCase(),
            monto_usd: Number(montoUSD),
            descripcion: descripcion,
            fecha: Date.now(),
            estado: 'pendiente'
          });
        }
      } catch (errSync) {
        console.warn("Firestore sync fiado omitido:", errSync);
      }
      
      setModalAbierto(false);
      setCliente('');
      setMontoUSD('');
      setDescripcion('');
      toast.success("Fiado registrado correctamente");
    } catch (err) {
      console.error(err);
      toast.error("Error registrando fiado");
    }
  };

  const abonarDeuda = async (e: React.FormEvent) => {
    e.preventDefault();
    const monto = Number(montoAbono);
    if (monto <= 0 || monto > modalAbono.deuda) {
      toast.error("Monto inválido");
      return;
    }

    const loadingToast = toast.loading("Procesando abono...");
    try {
      const nuevoMonto = modalAbono.deuda - monto;
      const abonoItem = {
        monto_usd: monto,
        fecha: Date.now()
      };

      // 1. Actualizar estado y VPS
      const current = fiados.find(f => f.id === modalAbono.fiadoId);
      if (current) {
        const updated: Fiado = {
          ...current,
          monto_usd: nuevoMonto,
          estado: nuevoMonto <= 0 ? 'pagado' : 'pendiente',
          historial_abonos: [...(current.historial_abonos || []), abonoItem]
        };
        await saveVPSFiado(updated);
        setFiados(prev => prev.map(f => f.id === updated.id ? updated : f));
      }

      // 2. Sincronizar Firestore en segundo plano
      try {
        await updateDoc(doc(db, 'fiados', modalAbono.fiadoId), {
          monto_usd: nuevoMonto,
          estado: nuevoMonto <= 0 ? 'pagado' : 'pendiente',
          historial_abonos: arrayUnion(abonoItem)
        });
      } catch {}

      setModalAbono({ abierto: false, fiadoId: '', cliente: '', deuda: 0 });
      setMontoAbono('');
      toast.success("Abono procesado con éxito", { id: loadingToast });
    } catch (err) {
      toast.error("Error al procesar abono", { id: loadingToast });
    }
  };

  const marcarPagado = async (fiado: Fiado) => {
    if(!confirm("¿Confirmar pago total de esta deuda?")) return;
    const loadingToast = toast.loading("Actualizando...");
    try {
      const abonoItem = {
        monto_usd: fiado.monto_usd,
        fecha: Date.now()
      };
      const updated: Fiado = {
        ...fiado,
        estado: 'pagado',
        monto_usd: 0,
        historial_abonos: [...(fiado.historial_abonos || []), abonoItem]
      };

      // 1. Guardar en VPS y estado local
      await saveVPSFiado(updated);
      setFiados(prev => prev.map(f => f.id === updated.id ? updated : f));

      // 2. Sincronizar Firestore
      try {
        await updateDoc(doc(db, 'fiados', fiado.id), { 
          estado: 'pagado', 
          monto_usd: 0,
          historial_abonos: arrayUnion(abonoItem)
        });
      } catch {}

      toast.success("Deuda saldada", { id: loadingToast });
    } catch (err) {
      console.error(err);
      toast.error("Error al actualizar la deuda", { id: loadingToast });
    }
  };

  return (
    <div className="flex flex-col h-full bg-white border-2 border-black max-w-5xl mx-auto w-full">
      <div className="p-4 md:p-6 border-b-2 border-black flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gray-50 shrink-0">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-widest text-black flex items-center gap-2">
            <Users className="text-black" /> Fiados
          </h1>
          <p className="text-[10px] font-mono text-gray-500 mt-1 uppercase tracking-widest">Total pendiente: <strong className="text-red-600">{formatUSD(totalPendiente)}</strong></p>
        </div>
        <button 
          onClick={() => setModalAbierto(true)}
          className="bg-black text-white flex items-center justify-center gap-2 px-6 py-4 font-black uppercase tracking-widest transition-all w-full md:w-auto hover:bg-yellow-400 hover:text-black border-2 border-black focus:outline-none"
        >
          <Plus size={18} />
          Nuevo Registro
        </button>
      </div>

      <div className="p-4 border-b-2 border-black bg-white shrink-0">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input 
            type="text" 
            placeholder="BUSCAR CLIENTE POR NOMBRE..." 
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="w-full pl-10 pr-4 py-4 border-2 border-black rounded-none focus:outline-none focus:border-yellow-400 font-mono text-xs uppercase tracking-widest bg-gray-50"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50 p-4 md:p-6 content-start pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {fiadosFiltrados.map(f => (
            <div key={f.id} className={`flex flex-col border-2 border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:-translate-y-1 transition-transform relative bg-white ${f.estado === 'pagado' ? 'opacity-70' : ''}`}>
              <div className="p-5 flex-1 flex flex-col">
                <div className="flex justify-between items-start mb-4">
                  <span className={cn(
                    "text-[8px] font-black px-2 py-0.5 uppercase tracking-widest text-white",
                    f.estado === 'pagado' ? 'bg-black' : 'bg-red-600'
                  )}>
                    {f.estado === 'pagado' ? 'LIQUIDADO' : 'PENDIENTE'}
                  </span>
                  <div className="text-[10px] text-gray-500 font-mono tracking-widest">
                    {format(f.fecha, 'dd/MM/yy')}
                  </div>
                </div>
                <h3 className="font-extrabold text-xl text-black mb-1 truncate">{f.cliente}</h3>
                {f.descripcion && (
                  <p className="text-[10px] text-gray-500 font-mono italic mb-4 line-clamp-2">🛒 {f.descripcion}</p>
                )}
                
                <div className="mt-auto border-t-2 border-dashed border-gray-300 pt-4 flex flex-col gap-4">
                  <div className="flex justify-between items-center">
                    {f.estado === 'pagado' ? <div></div> : (
                      <button 
                        onClick={() => {
                          setCliente(f.cliente);
                          setMontoUSD('');
                          setDescripcion('');
                          setModalAbierto(true);
                        }}
                        className="flex items-center gap-1 bg-white text-black px-3 py-1.5 border-2 border-black font-black uppercase text-[10px] tracking-widest hover:bg-black hover:text-white transition-colors shadow-[2px_2px_0px_rgba(0,0,0,1)]"
                        title="Sumar más deuda a este cliente"
                      >
                        <Plus size={12} /> AÑADIR
                      </button>
                    )}
                    <div className="flex flex-col items-end">
                      <div className="font-black text-2xl mb-0 leading-none">{formatUSD(f.monto_usd)}</div>
                      <div className="text-[10px] text-gray-400 font-mono">{formatBs(f.monto_usd * tasaDolar).replace('Bs. ', '')} VED</div>
                    </div>
                  </div>
                  
                  {f.estado === 'pendiente' && (
                    <div className="w-full flex flex-col gap-2">
                      <button 
                        onClick={() => setModalAbono({ abierto: true, fiadoId: f.id, cliente: f.cliente, deuda: f.monto_usd })}
                        className="w-full flex items-center justify-center gap-2 text-[10px] font-black text-black border-2 border-black bg-white py-2 uppercase tracking-widest hover:bg-black hover:text-white transition-all shadow-[2px_2px_0px_rgba(0,0,0,1)]"
                      >
                        <CreditCard size={14} /> ABONAR
                      </button>
                      <button 
                        onClick={() => marcarPagado(f)}
                        className="w-full flex items-center justify-center gap-2 text-[10px] font-black text-black border-2 border-black bg-yellow-400 py-2 uppercase tracking-widest hover:bg-black hover:text-white transition-all shadow-[2px_2px_0px_rgba(0,0,0,1)]"
                      >
                        <Check size={14} /> PAGAR TODO
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Historial Toggle */}
              {f.historial_abonos && f.historial_abonos.length > 0 && (
                <div className="border-t-2 border-black">
                  <button 
                    onClick={() => setExpandedHistorial(expandedHistorial === f.id ? null : f.id)}
                    className="w-full py-2 px-4 flex justify-between items-center bg-gray-50 text-[9px] font-black uppercase tracking-widest hover:bg-gray-100"
                  >
                    <span className="flex items-center gap-2"><History size={12} /> Ver historial de pagos</span>
                    {expandedHistorial === f.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                  {expandedHistorial === f.id && (
                    <div className="p-3 bg-white space-y-2 border-t border-black max-h-32 overflow-y-auto">
                      {f.historial_abonos.map((abono, idx) => (
                        <div key={idx} className="flex justify-between items-center text-[10px] font-mono">
                          <span className="text-gray-400">{format(abono.fecha, 'dd/MM/yy HH:mm')}</span>
                          <span className="font-bold text-green-600">+{formatUSD(abono.monto_usd)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {fiadosFiltrados.length === 0 && (
            <div className="col-span-full py-12 text-center text-gray-400 uppercase tracking-widest font-bold text-xs italic">
              No hay cuentas encontradas.
            </div>
          )}
        </div>
      </div>

      {modalAbierto && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] w-full max-w-md overflow-hidden relative animate-in zoom-in-95 duration-200">
            <button onClick={() => setModalAbierto(false)} className="absolute top-4 right-4 text-black hover:text-red-600 z-10 transition-colors">
              <X size={24} />
            </button>
            <div className="p-6 border-b-2 border-black bg-yellow-400">
              <h2 className="font-black text-xl uppercase tracking-widest mr-6">Registrar Deuda</h2>
            </div>
            <form onSubmit={guardarFiado} className="p-6 space-y-6">
              <div className="relative">
                <label className="block text-[10px] font-black uppercase tracking-widest text-black mb-2">Nombre del Cliente</label>
                <div className="flex bg-gray-50 border-2 border-black focus-within:border-yellow-400">
                  <input 
                    required 
                    type="text" 
                    list="clientes-existentes"
                    value={cliente} 
                    onChange={e=>setCliente(e.target.value)} 
                    className="w-full bg-transparent p-4 font-bold focus:outline-none" 
                    placeholder="ESCRIBE O SELECCIONA..." 
                  />
                  <div className="flex items-center pr-4 pointer-events-none text-gray-400">
                     <ChevronDown size={18} />
                  </div>
                </div>
                <datalist id="clientes-existentes">
                  {[...new Set(fiados.map(f => f.cliente))].sort().map(c => <option key={c} value={c} />)}
                </datalist>
                <p className="text-[8px] font-mono text-gray-400 mt-1 uppercase tracking-tighter">Si el cliente ya tiene una deuda pendiente, se sumará al total.</p>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-black mb-2">Productos / Detalles</label>
                <textarea 
                  value={descripcion} 
                  onChange={e=>setDescripcion(e.target.value)} 
                  className="w-full border-2 border-black p-4 rounded-none focus:outline-none focus:border-yellow-400 font-bold text-xs" 
                  placeholder="Escribe que se llevó..." 
                  rows={2}
                />
              </div>

              <div className="bg-gray-50 p-4 border-2 border-black">
                <label className="block text-[10px] font-black uppercase tracking-widest text-black mb-2">Monto a Fiar (USD)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-gray-400">$</span>
                  <input required type="number" step="0.01" min="0.01" value={montoUSD} onChange={e=>setMontoUSD(e.target.value)} className="w-full pl-10 pr-4 py-4 border-2 border-black rounded-none focus:outline-none focus:border-red-600 font-mono font-bold text-lg" placeholder="0.00" />
                </div>
                <div className="text-[10px] font-mono text-gray-500 mt-3 uppercase tracking-widest flex justify-between border-t border-dashed border-gray-300 pt-3">
                  <span>En Bolívares:</span>
                  <span className="font-black text-black">{formatBs((Number(montoUSD)||0) * tasaDolar)}</span>
                </div>
              </div>
              <div className="pt-4 flex border-t-2 border-black -mx-6 -mb-6">
                <button type="button" onClick={() => setModalAbierto(false)} className="w-1/2 py-4 font-black text-black uppercase tracking-widest hover:bg-gray-100 border-r-2 border-black">Cancelar</button>
                <button type="submit" className="w-1/2 py-4 font-black bg-yellow-400 text-black uppercase tracking-widest hover:bg-black hover:text-white transition-colors">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalAbono.abierto && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] w-full max-w-md overflow-hidden relative animate-in zoom-in-95 duration-200">
            <button onClick={() => setModalAbono({ ...modalAbono, abierto: false })} className="absolute top-4 right-4 text-black hover:text-red-600 z-10 transition-colors">
              <X size={24} />
            </button>
            <div className="p-6 border-b-2 border-black bg-yellow-400">
              <h2 className="font-black text-xl uppercase tracking-widest mr-6">Registrar Abono</h2>
            </div>
            <form onSubmit={abonarDeuda} className="p-6 space-y-6">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Cliente</p>
                <p className="text-xl font-black text-black">{modalAbono.cliente}</p>
                <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mt-1">Deuda pendiente: <span className="text-red-600 font-bold">{formatUSD(modalAbono.deuda)}</span></p>
              </div>
              
              <div className="bg-gray-50 p-4 border-2 border-black">
                <label className="block text-[10px] font-black uppercase tracking-widest text-black mb-2">Monto a Abonar (USD)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-gray-400">$</span>
                  <input 
                    required 
                    type="number" 
                    step="0.01" 
                    min="0.01" 
                    max={modalAbono.deuda}
                    value={montoAbono} 
                    onChange={e=>setMontoAbono(e.target.value)} 
                    className="w-full pl-10 pr-4 py-4 border-2 border-black rounded-none focus:outline-none focus:border-green-600 font-mono font-bold text-lg" 
                    placeholder="0.00" 
                  />
                </div>
                <div className="text-[10px] font-mono text-gray-500 mt-3 uppercase tracking-widest flex justify-between border-t border-dashed border-gray-300 pt-3">
                  <span>Equivalente BS:</span>
                  <span className="font-black text-black">{formatBs((Number(montoAbono)||0) * tasaDolar)}</span>
                </div>
              </div>

              <div className="pt-4 flex border-t-2 border-black -mx-6 -mb-6">
                <button type="button" onClick={() => setModalAbono({ ...modalAbono, abierto: false })} className="w-1/2 py-4 font-black text-black uppercase tracking-widest hover:bg-gray-100 border-r-2 border-black">Cancelar</button>
                <button type="submit" className="w-1/2 py-4 font-black bg-black text-white uppercase tracking-widest hover:bg-yellow-400 hover:text-black transition-all">Confirmar Abono</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
