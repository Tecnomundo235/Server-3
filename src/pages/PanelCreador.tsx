import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { ShieldAlert, Plus, Trash2, KeyRound, Copy, Check, Save, Lock } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

interface CodigoAcceso {
  id: string;
  rol: 'admin' | 'cajero';
  usado: boolean;
  usadoPor?: string;
  creadoPor: string;
  creadoEn: number;
}

export default function PanelCreador() {
  const { role, user, pinesConfig, actualizarPines } = useAuth();
  const [codigos, setCodigos] = useState<CodigoAcceso[]>([]);
  const [generando, setGenerando] = useState(false);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  // Estados locales para edición de PINs
  const [pinAdmin, setPinAdmin] = useState(pinesConfig.pinAdmin || '2026');
  const [pinCajero, setPinCajero] = useState(pinesConfig.pinCajero || '1234');
  const [pinSuperadmin, setPinSuperadmin] = useState(pinesConfig.pinSuperadmin || '7799');
  const [guardandoPines, setGuardandoPines] = useState(false);

  useEffect(() => {
    setPinAdmin(pinesConfig.pinAdmin || '2026');
    setPinCajero(pinesConfig.pinCajero || '1234');
    setPinSuperadmin(pinesConfig.pinSuperadmin || '7799');
  }, [pinesConfig]);

  useEffect(() => {
    if (role !== 'superadmin') return;

    const unsub = onSnapshot(collection(db, 'codigos'), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as CodigoAcceso));
      setCodigos(data.sort((a,b) => b.creadoEn - a.creadoEn));
    });

    return () => unsub();
  }, [role]);

  const handleGuardarPines = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardandoPines(true);
    const toastId = toast.loading("Guardando nuevos PINs...");
    try {
      const ok = await actualizarPines({
        pinAdmin: pinAdmin.trim(),
        pinCajero: pinCajero.trim(),
        pinSuperadmin: pinSuperadmin.trim()
      });
      if (ok) {
        toast.success("¡PINs de seguridad actualizados con éxito!", { id: toastId });
      } else {
        toast.error("Error al guardar PINs.", { id: toastId });
      }
    } catch (err) {
      console.error(err);
      toast.error("Error al actualizar PINs.", { id: toastId });
    } finally {
      setGuardandoPines(false);
    }
  };

  const generarCodigoConIdPropio = async (rol: 'admin' | 'cajero') => {
    if (!user) return;
    setGenerando(true);
    const toastId = toast.loading("Generando token de acceso...");
    try {
      const codigoRaw = Math.random().toString(36).substring(2, 8).toUpperCase();
      await setDoc(doc(db, 'codigos', codigoRaw), {
        rol,
        usado: false,
        creadoPor: user.uid,
        creadoEn: Date.now()
      });
      toast.success(`Código ${codigoRaw} generado con éxito`, { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error("Error al generar código.", { id: toastId });
    } finally {
      setGenerando(false);
    }
  };

  const copiarAlPortapapeles = (texto: string, id: string) => {
    navigator.clipboard.writeText(texto);
    setCopiadoId(id);
    toast.success(`Copiado: ${texto}`);
    setTimeout(() => setCopiadoId(null), 2000);
  };

  const eliminarCodigo = async (id: string) => {
    if (!confirm('¿Seguro que desea eliminar este código?')) return;
    try {
      await deleteDoc(doc(db, 'codigos', id));
      toast.success("Código eliminado.");
    } catch (err) {
      console.error(err);
      toast.error("Error al eliminar código.");
    }
  };

  if (role !== 'superadmin') {
    return <div className="p-8 text-center text-gray-500 font-bold uppercase tracking-widest">ACCESO DENEGADO</div>;
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 overflow-y-auto w-full max-h-screen bg-gray-50">
      <div className="flex items-center gap-3 text-red-600 border-b-2 border-black pb-4 bg-white p-4 border-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <ShieldAlert size={32} />
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 uppercase">Panel Super Admin</h1>
          <p className="text-xs text-gray-600 font-mono">Gestión de accesos, PINs y seguridad sin depender de Google</p>
        </div>
      </div>

      {/* 1. SECCIÓN DE PINES MAESTROS DE TIENDA */}
      <div className="bg-white border-2 border-black p-4 sm:p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex items-center justify-between border-b-2 border-black pb-3 mb-4">
          <div className="flex items-center gap-2">
            <Lock className="text-black" size={20} />
            <h2 className="text-base font-black uppercase tracking-wider text-black">PINs de Acceso Directo a la Tienda</h2>
          </div>
          <span className="text-[10px] bg-yellow-400 font-mono font-bold px-2 py-0.5 border border-black uppercase">
            Sin Google
          </span>
        </div>

        <p className="text-xs text-gray-600 mb-4 font-medium">
          Estos PINs permiten que la dueña y las cajeras entren al sistema directamente desde el botón o teclado de la pantalla de inicio, sin requerir cuentas de Google ni ventanas emergentes.
        </p>

        <form onSubmit={handleGuardarPines} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* PIN Dueña */}
          <div className="border-2 border-black p-3 bg-amber-50/50">
            <label className="block text-[11px] font-black uppercase tracking-wider text-black mb-1">
              🛍️ PIN Dueña (Admin)
            </label>
            <input
              type="text"
              required
              value={pinAdmin}
              onChange={e => setPinAdmin(e.target.value)}
              className="w-full p-2 border-2 border-black font-mono font-black text-center text-lg bg-white"
            />
            <p className="text-[10px] text-gray-500 mt-1 font-mono">Permisos totales de venta e inventario</p>
          </div>

          {/* PIN Cajera */}
          <div className="border-2 border-black p-3 bg-blue-50/50">
            <label className="block text-[11px] font-black uppercase tracking-wider text-black mb-1">
              🛒 PIN Cajera (POS)
            </label>
            <input
              type="text"
              required
              value={pinCajero}
              onChange={e => setPinCajero(e.target.value)}
              className="w-full p-2 border-2 border-black font-mono font-black text-center text-lg bg-white"
            />
            <p className="text-[10px] text-gray-500 mt-1 font-mono">Permiso para facturar ventas</p>
          </div>

          {/* PIN Superadmin */}
          <div className="border-2 border-black p-3 bg-purple-50/50">
            <label className="block text-[11px] font-black uppercase tracking-wider text-black mb-1">
              👑 PIN Super Admin
            </label>
            <input
              type="text"
              required
              value={pinSuperadmin}
              onChange={e => setPinSuperadmin(e.target.value)}
              className="w-full p-2 border-2 border-black font-mono font-black text-center text-lg bg-white"
            />
            <p className="text-[10px] text-gray-500 mt-1 font-mono">Acceso total al creador</p>
          </div>

          <div className="sm:col-span-3 flex justify-end">
            <button
              type="submit"
              disabled={guardandoPines}
              className="flex items-center gap-2 bg-yellow-400 text-black border-2 border-black font-black uppercase text-xs px-5 py-2.5 hover:bg-black hover:text-white transition-all cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              <Save size={16} />
              {guardandoPines ? "Guardando..." : "Guardar PINs en la Nube"}
            </button>
          </div>
        </form>
      </div>

      {/* 2. GENERADOR DE CÓDIGOS DE UN SOLO USO */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Generar Código Dueña */}
        <div className="bg-white p-5 border-2 border-black flex flex-col gap-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex justify-between items-center">
            <h2 className="font-extrabold text-base uppercase tracking-wider">Código Especial Dueña</h2>
            <KeyRound className="text-orange-500" />
          </div>
          <p className="text-xs text-gray-600 font-medium">
            Genera un token de 6 dígitos para otorgar rol de Dueña.
          </p>
          <button
            onClick={() => generarCodigoConIdPropio('admin')}
            disabled={generando}
            className="mt-auto bg-black text-white hover:bg-zinc-800 font-bold py-3 uppercase tracking-widest flex justify-center items-center gap-2 transition-all cursor-pointer"
          >
            <Plus size={18} /> Crear Token Dueña
          </button>
        </div>

        {/* Generar Código Cajero */}
        <div className="bg-white p-5 border-2 border-black flex flex-col gap-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex justify-between items-center">
            <h2 className="font-extrabold text-base uppercase tracking-wider">Código Especial Cajera</h2>
            <KeyRound className="text-blue-500" />
          </div>
          <p className="text-xs text-gray-600 font-medium">
            Genera un token de 6 dígitos para otorgar rol de Cajera.
          </p>
          <button
            onClick={() => generarCodigoConIdPropio('cajero')}
            disabled={generando}
            className="mt-auto border-2 border-black bg-white text-black hover:bg-black hover:text-white font-bold py-3 uppercase tracking-widest flex justify-center items-center gap-2 transition-all cursor-pointer"
          >
            <Plus size={18} /> Crear Token Cajera
          </button>
        </div>
      </div>

      {/* 3. LISTA DE TOKENS EMITIDOS */}
      <div className="bg-white border-2 border-black flex-1 flex flex-col shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <div className="p-4 border-b border-black flex justify-between items-center bg-gray-50">
          <h2 className="font-black uppercase tracking-widest text-sm">Tokens Emitidos</h2>
          <span className="font-mono text-xs bg-black text-white px-2 py-1">{codigos.length}</span>
        </div>
        <div className="overflow-x-auto min-h-[200px] p-0">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="border-b border-gray-200 text-gray-500 uppercase text-[10px] tracking-widest">
              <tr>
                <th className="p-4 font-bold">Código (Token)</th>
                <th className="p-4 font-bold">Rol</th>
                <th className="p-4 font-bold">Estado</th>
                <th className="p-4 font-bold">Fecha</th>
                <th className="p-4 font-bold text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {codigos.map(cod => (
                <tr key={cod.id} className="hover:bg-gray-50 transition-colors">
                  <td className="p-4 font-mono font-black text-base text-gray-900 flex items-center gap-2">
                    <span>{cod.id}</span>
                    <button 
                      onClick={() => copiarAlPortapapeles(cod.id, cod.id)}
                      className="p-1 text-gray-400 hover:text-black cursor-pointer"
                      title="Copiar token"
                    >
                      {copiadoId === cod.id ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                    </button>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 font-black uppercase text-[10px] tracking-widest ${cod.rol === 'admin' ? 'bg-orange-100 text-orange-700' : 'bg-gray-200 text-gray-700'}`}>
                      {cod.rol}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 font-bold uppercase text-[10px] tracking-widest ${cod.usado ? 'bg-red-100 text-red-700 block text-center' : 'bg-green-100 text-green-700 block text-center'}`}>
                      {cod.usado ? 'USADO' : 'DISPONIBLE'}
                    </span>
                  </td>
                  <td className="p-4 text-xs text-gray-500 font-mono">{format(cod.creadoEn, 'dd/MM/yy HH:mm')}</td>
                  <td className="p-4 text-right">
                    <button onClick={() => eliminarCodigo(cod.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-all cursor-pointer">
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
              {codigos.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400 uppercase tracking-widest font-bold text-xs">Aún no has generado tokens.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
