import React, { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { signInWithGoogle, db } from "../lib/firebase";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { ShieldAlert, KeyRound, LogOut, Lock, ArrowRight, ShieldCheck, UserCheck, Sparkles } from "lucide-react";
import BibiStoreLogo from "../components/BibiStoreLogo";
import toast from "react-hot-toast";

export default function Login() {
  const { user, loading, role, loginWithPin, logout } = useAuth();
  const [pinIngresado, setPinIngresado] = useState("");
  const [verificando, setVerificando] = useState(false);
  const [mostrarAyuda, setMostrarAyuda] = useState(false);

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-black"></div>
          <p className="font-mono text-xs uppercase tracking-widest font-black">Cargando Bibi Store...</p>
        </div>
      </div>
    );
  }

  // Si ya tiene rol asignado, redirigir directo a la app
  if (user && role !== 'none') {
    return <Navigate to="/" replace />;
  }

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinIngresado.trim()) return;
    setVerificando(true);
    const toastId = toast.loading("Verificando acceso...");

    try {
      const res = await loginWithPin(pinIngresado.trim());
      if (res.success) {
        toast.success(`¡Bienvenido/a como ${res.role?.toUpperCase()}!`, { id: toastId });
      } else {
        toast.error(res.message || "PIN o código incorrecto", { id: toastId });
      }
    } catch (err: any) {
      console.error("Error en login con PIN:", err);
      toast.error("Error al validar acceso. Intenta de nuevo.", { id: toastId });
    } finally {
      setVerificando(false);
    }
  };

  const handleQuickPin = (pin: string) => {
    setPinIngresado(pin);
  };

  // En caso de que haya iniciado sesión con Google pero no tenga rol asignado
  const canjearCodigoGoogle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setVerificando(true);
    const toastId = toast.loading("Asignando permisos a tu cuenta...");

    try {
      const pin = pinIngresado.trim().toUpperCase();

      // Si ingresó uno de los PINs maestros
      let rolAsignado = '';
      if (pin === '7799') rolAsignado = 'superadmin';
      else if (pin === '2026') rolAsignado = 'admin';
      else if (pin === '1234') rolAsignado = 'cajero';

      if (!rolAsignado) {
        // Verificar si es un token de un solo uso
        const docRef = doc(db, 'codigos', pin);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && !docSnap.data().usado) {
          rolAsignado = docSnap.data().rol || 'cajero';
          await updateDoc(docRef, { usado: true, usadoPor: user.uid }).catch(() => {});
        }
      }

      if (!rolAsignado) {
        toast.error("El código o PIN ingresado no es válido.", { id: toastId });
        setVerificando(false);
        return;
      }

      // Guardar el rol en Firestore para este usuario Google
      await setDoc(doc(db, 'usuarios', user.uid), {
        rol: rolAsignado,
        codigo_usado: pin,
        email: user.email || '',
        displayName: user.displayName || '',
        actualizadoEn: Date.now()
      }, { merge: true });

      toast.success(`¡Permisos asignados como ${rolAsignado.toUpperCase()}!`, { id: toastId });
      // Redirigir de inmediato actualizando sesión local
      localStorage.setItem('bibi_store_session', JSON.stringify({
        user: { ...user, authMethod: 'google' },
        role: rolAsignado
      }));
      window.location.href = '/';

    } catch (err: any) {
      console.error("Error asignando rol:", err);
      toast.error("Ocurrió un error al procesar el código.", { id: toastId });
    } finally {
      setVerificando(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-100 flex flex-col justify-center py-6 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md flex flex-col items-center">
        <div className="flex justify-center text-black mb-2 w-28 h-28 relative bg-white p-2 border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <BibiStoreLogo className="h-full w-full object-contain" />
        </div>
        <h1 className="text-center text-3xl sm:text-4xl font-black tracking-tighter text-black uppercase mt-2">
          BIBI STORE
        </h1>
        <p className="text-center text-xs font-mono text-gray-600 uppercase tracking-widest font-bold">
          Control de Inventario & Ventas POS
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-6 px-4 sm:px-8 border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)]">
          
          {user && role === 'none' ? (
            /* Pantalla para usuario Google sin rol todavía */
            <div className="flex flex-col gap-5">
              <div className="bg-amber-50 p-4 border-2 border-black flex items-start gap-3">
                <ShieldAlert className="text-amber-600 shrink-0 mt-0.5" size={24} />
                <div>
                  <h3 className="text-xs font-black uppercase tracking-widest text-black">Cuenta Conectada</h3>
                  <p className="text-xs text-gray-700 mt-1 font-medium">
                    Iniciaste sesión con <span className="font-bold underline">{user.email}</span>, pero aún no tiene un rol asignado.
                  </p>
                </div>
              </div>

              <form onSubmit={canjearCodigoGoogle} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-black uppercase tracking-widest text-black mb-1.5">
                    Ingresa el PIN de Acceso o Código
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                    <input
                      type="text"
                      required
                      placeholder="EJ: 2026 O 1234..."
                      value={pinIngresado}
                      onChange={e => setPinIngresado(e.target.value.toUpperCase())}
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 uppercase tracking-widest font-mono font-bold text-sm border-2 border-black focus:outline-none focus:bg-yellow-50 focus:border-black"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={verificando || !pinIngresado.trim()}
                  className="w-full flex justify-center items-center gap-2 py-3.5 px-4 font-black text-black bg-yellow-400 border-2 border-black hover:bg-black hover:text-white uppercase tracking-widest disabled:opacity-50 transition-all cursor-pointer shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5"
                >
                  {verificando ? "VERIFICANDO..." : "ACTIVAR ACCESO"}
                </button>
              </form>

              <div className="pt-2 border-t-2 border-gray-200">
                <button 
                  onClick={logout} 
                  className="w-full py-2 flex items-center justify-center gap-2 text-xs font-bold text-gray-600 hover:text-red-600 uppercase tracking-widest cursor-pointer"
                >
                  <LogOut size={16} /> Cerrar y entrar con otro método
                </button>
              </div>
            </div>
          ) : (
            /* Pantalla principal de Acceso Autónomo sin Google */
            <div className="space-y-5">
              <div className="border-b-2 border-black pb-3 text-center">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-yellow-400 border-2 border-black text-xs font-black uppercase tracking-wider mb-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                  <Lock size={14} /> Acceso Directo por PIN
                </div>
                <p className="text-xs text-gray-600 font-medium">
                  Inicia sesión al instante sin depender de cuentas externas ni bloqueos de navegador.
                </p>
              </div>

              {/* Formulario de PIN */}
              <form onSubmit={handlePinSubmit} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-black uppercase tracking-widest text-black mb-1.5 flex justify-between">
                    <span>PIN de la Tienda</span>
                    <button 
                      type="button" 
                      onClick={() => setMostrarAyuda(!mostrarAyuda)}
                      className="text-[10px] text-gray-500 underline font-normal normal-case hover:text-black"
                    >
                      {mostrarAyuda ? "Ocultar PINs" : "Ver PINs de Acceso"}
                    </button>
                  </label>

                  <div className="relative">
                    <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" size={20} />
                    <input
                      type="password"
                      inputMode="numeric"
                      required
                      autoFocus
                      placeholder="INGRESE PIN O TOKEN..."
                      value={pinIngresado}
                      onChange={e => setPinIngresado(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 bg-gray-50 tracking-widest font-mono font-black text-base border-2 border-black focus:outline-none focus:bg-yellow-50 focus:border-black"
                    />
                  </div>
                </div>

                {/* Botones de PIN rápido */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleQuickPin("2026")}
                    className="p-2 border-2 border-black text-left bg-zinc-50 hover:bg-yellow-300 transition-colors cursor-pointer"
                  >
                    <span className="block text-[10px] font-black uppercase tracking-wider text-black">Dueña / Admin</span>
                    <span className="block font-mono text-xs text-gray-600 font-bold">PIN: 2026</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleQuickPin("1234")}
                    className="p-2 border-2 border-black text-left bg-zinc-50 hover:bg-yellow-300 transition-colors cursor-pointer"
                  >
                    <span className="block text-[10px] font-black uppercase tracking-wider text-black">Cajera / POS</span>
                    <span className="block font-mono text-xs text-gray-600 font-bold">PIN: 1234</span>
                  </button>
                </div>

                {mostrarAyuda && (
                  <div className="bg-yellow-50 border-2 border-black p-3 text-xs space-y-1 font-mono">
                    <p className="font-bold text-black uppercase">PINs Configurables:</p>
                    <p className="text-gray-800">👑 <strong>Super Admin:</strong> 7799</p>
                    <p className="text-gray-800">🛍️ <strong>Dueña:</strong> 2026</p>
                    <p className="text-gray-800">🛒 <strong>Cajera:</strong> 1234</p>
                    <p className="text-[10px] text-gray-500 pt-1">Puedes modificarlos en el Panel de Ajustes / Creador.</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={verificando || !pinIngresado.trim()}
                  className="w-full flex justify-center items-center gap-2 py-4 px-4 font-black text-black bg-yellow-400 border-2 border-black hover:bg-black hover:text-white uppercase tracking-widest text-sm transition-all cursor-pointer shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50"
                >
                  {verificando ? "COMPROBANDO..." : (
                    <>
                      <span>INGRESAR AL SISTEMA</span>
                      <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </form>

              {/* Opción secundaria con Google */}
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300"></div>
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-gray-500 font-mono text-[10px]">O si prefieres</span>
                </div>
              </div>

              <button
                type="button"
                onClick={async () => {
                  try {
                    await signInWithGoogle();
                  } catch (e: any) {
                    console.error("Google login error:", e);
                    toast.error("Google bloqueó la ventana emergente. Usa el PIN de arriba.");
                  }
                }}
                className="w-full flex items-center justify-center gap-3 py-3 px-4 border-2 border-black text-xs font-black uppercase tracking-wider text-black bg-white hover:bg-gray-100 transition-all cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                </svg>
                <span>Acceder con Google</span>
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
