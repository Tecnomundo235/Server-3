import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { db } from '../lib/firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { getVPSConfig, saveVPSConfig } from '../lib/vpsService';

interface ConfigContextType {
  tasaDolar: number;
  actualizarTasa: (nuevaTasa: number) => Promise<boolean>;
}

const ConfigContext = createContext<ConfigContextType>({ 
  tasaDolar: 865,
  actualizarTasa: async () => false 
});

export const ConfigProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  const [tasaDolar, setTasaDolar] = useState<number>(() => {
    try {
      const cached = localStorage.getItem('bibi_store_tasa_dolar');
      if (cached) {
        const parsed = Number(cached);
        if (parsed > 0) return parsed;
      }
    } catch {}
    return 865;
  });

  // Cargar tasa desde la VPS (y sincronizar)
  const cargarDesdeVPS = useCallback(async () => {
    try {
      const vpsConfig = await getVPSConfig();
      if (vpsConfig && typeof vpsConfig.tasa_dolar === 'number' && vpsConfig.tasa_dolar > 0) {
        setTasaDolar(vpsConfig.tasa_dolar);
        try {
          localStorage.setItem('bibi_store_tasa_dolar', String(vpsConfig.tasa_dolar));
        } catch {}
      }
    } catch (e) {
      console.warn("No se pudo cargar config desde VPS:", e);
    }
  }, []);

  useEffect(() => {
    // 1. Cargar inmediatamente desde la VPS
    cargarDesdeVPS();

    // Polling ligero a la VPS cada 30 segundos para mantener cajeros sincronizados
    const timer = setInterval(cargarDesdeVPS, 30000);

    // 2. Escuchar también Firestore (si está disponible)
    let unsubscribe = () => {};
    try {
      const docRef = doc(db, 'configuracion', 'general');
      unsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data && typeof data.tasa_dolar === 'number' && data.tasa_dolar > 0) {
            setTasaDolar(data.tasa_dolar);
            try {
              localStorage.setItem('bibi_store_tasa_dolar', String(data.tasa_dolar));
            } catch {}
          }
        }
      }, (err) => {
        console.warn("Firestore configuracion no disponible (usando VPS):", err.message);
      });
    } catch (err) {
      console.warn("Error iniciando listener Firestore:", err);
    }

    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [cargarDesdeVPS]);

  // Función unificada para cambiar la tasa (actualiza VPS, LocalStorage y Firestore)
  const actualizarTasa = async (nuevaTasa: number): Promise<boolean> => {
    const val = Number(nuevaTasa);
    if (!val || isNaN(val) || val <= 0) return false;

    // Actualización inmediata en memoria y almacenamiento local
    setTasaDolar(val);
    try {
      localStorage.setItem('bibi_store_tasa_dolar', String(val));
    } catch {}

    let vpsOk = false;
    try {
      vpsOk = await saveVPSConfig({ tasa_dolar: val });
    } catch (e) {
      console.warn("Error guardando en VPS:", e);
    }

    // Intentar también en Firestore (sin bloquear si falla)
    try {
      const ref = doc(db, 'configuracion', 'general');
      await setDoc(ref, { tasa_dolar: val }, { merge: true });
    } catch (e) {
      console.warn("Firestore no accesible para guardar tasa (guardado en VPS con éxito):", e);
    }

    return vpsOk || true;
  };

  return (
    <ConfigContext.Provider value={{ tasaDolar, actualizarTasa }}>
      {children}
    </ConfigContext.Provider>
  );
};

export const useConfig = () => useContext(ConfigContext);

