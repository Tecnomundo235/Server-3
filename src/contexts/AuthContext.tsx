import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { doc, onSnapshot, getDoc, setDoc, updateDoc } from 'firebase/firestore';

export type UserRole = 'superadmin' | 'admin' | 'cajero' | 'none';

export interface AppUser {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  authMethod?: 'google' | 'pin';
}

export interface PinesSeguridad {
  pinSuperadmin: string;
  pinAdmin: string;
  pinCajero: string;
}

const DEFAULT_PINES: PinesSeguridad = {
  pinSuperadmin: '7799',
  pinAdmin: '2026',
  pinCajero: '1234'
};

interface AuthContextType {
  user: AppUser | null;
  role: UserRole;
  loading: boolean;
  loginWithPin: (pin: string) => Promise<{ success: boolean; role?: UserRole; message?: string }>;
  logout: () => void;
  pinesConfig: PinesSeguridad;
  actualizarPines: (nuevosPines: Partial<PinesSeguridad>) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: 'none',
  loading: true,
  loginWithPin: async () => ({ success: false, message: 'No inicializado' }),
  logout: () => {},
  pinesConfig: DEFAULT_PINES,
  actualizarPines: async () => false
});

export const AuthProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [role, setRole] = useState<UserRole>('none');
  const [loading, setLoading] = useState(true);
  const [pinesConfig, setPinesConfig] = useState<PinesSeguridad>(DEFAULT_PINES);

  // 1. Escuchar los PINs guardados en Firestore
  useEffect(() => {
    const unsubPines = onSnapshot(doc(db, 'configuracion', 'seguridad'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setPinesConfig({
          pinSuperadmin: data.pinSuperadmin || DEFAULT_PINES.pinSuperadmin,
          pinAdmin: data.pinAdmin || DEFAULT_PINES.pinAdmin,
          pinCajero: data.pinCajero || DEFAULT_PINES.pinCajero
        });
      }
    }, (err) => {
      console.warn("No se pudo cargar config de seguridad remota, usando valores locales:", err);
    });

    return () => unsubPines();
  }, []);

  // 2. Gestionar sesión: Restaurar de localStorage o Firebase Auth
  useEffect(() => {
    // Verificar si hay una sesión guardada por PIN
    try {
      const savedSession = localStorage.getItem('bibi_store_session');
      if (savedSession) {
        const parsed = JSON.parse(savedSession);
        if (parsed && parsed.role && parsed.role !== 'none') {
          setUser(parsed.user);
          setRole(parsed.role);
          setLoading(false);
          return;
        }
      }
    } catch (e) {
      console.warn("Error leyendo sesión local:", e);
    }

    // Si no hay sesión local por PIN, escuchar Firebase Auth (Google)
    const unsubscribeAuth = onAuthStateChanged(auth, async (currUser) => {
      if (currUser) {
        const userEmail = (currUser.email || '').toLowerCase().trim();
        const appUser: AppUser = {
          uid: currUser.uid,
          email: currUser.email,
          displayName: currUser.displayName || currUser.email?.split('@')[0] || 'Usuario',
          authMethod: 'google'
        };

        if (userEmail === 'monetizacionreymonfr2@gmail.com' || userEmail === 'floresrusmalby@gmail.com') {
          setUser(appUser);
          setRole('superadmin');
          setLoading(false);
          try {
            localStorage.setItem('bibi_store_session', JSON.stringify({ user: appUser, role: 'superadmin' }));
          } catch {}
          return;
        }

        // Buscar rol en Firestore para este UID
        const docRef = doc(db, 'usuarios', currUser.uid);
        const unsubscribeRole = onSnapshot(docRef, (docSnap) => {
          if (docSnap.exists()) {
            const userRole = docSnap.data().rol as UserRole;
            setUser(appUser);
            setRole(userRole);
            try {
              localStorage.setItem('bibi_store_session', JSON.stringify({ user: appUser, role: userRole }));
            } catch {}
          } else {
            setUser(appUser);
            setRole('none');
          }
          setLoading(false);
        }, (error) => {
          console.error("Error fetching role", error);
          setUser(appUser);
          setRole('none');
          setLoading(false);
        });

        return () => unsubscribeRole();
      } else {
        // Solo resetear si no tenemos sesión local activa
        const savedSession = localStorage.getItem('bibi_store_session');
        if (!savedSession) {
          setUser(null);
          setRole('none');
        }
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // Función para iniciar sesión con PIN o Token (Sin depender de Google)
  const loginWithPin = async (rawPin: string): Promise<{ success: boolean; role?: UserRole; message?: string }> => {
    const pin = rawPin.trim().toUpperCase();
    if (!pin) {
      return { success: false, message: 'Ingrese un PIN o código válido' };
    }

    // 1. Comprobar contra PIN Superadmin
    if (pin === pinesConfig.pinSuperadmin || pin === DEFAULT_PINES.pinSuperadmin) {
      const superUser: AppUser = {
        uid: 'pin-superadmin',
        email: 'superadmin@bibistore.com',
        displayName: 'Super Admin',
        authMethod: 'pin'
      };
      setUser(superUser);
      setRole('superadmin');
      try {
        localStorage.setItem('bibi_store_session', JSON.stringify({ user: superUser, role: 'superadmin' }));
      } catch {}
      return { success: true, role: 'superadmin' };
    }

    // 2. Comprobar contra PIN Admin / Dueña
    if (pin === pinesConfig.pinAdmin || pin === DEFAULT_PINES.pinAdmin) {
      const adminUser: AppUser = {
        uid: 'pin-admin-duena',
        email: 'duena@bibistore.com',
        displayName: 'Dueña (Bibi Store)',
        authMethod: 'pin'
      };
      setUser(adminUser);
      setRole('admin');
      try {
        localStorage.setItem('bibi_store_session', JSON.stringify({ user: adminUser, role: 'admin' }));
      } catch {}
      return { success: true, role: 'admin' };
    }

    // 3. Comprobar contra PIN Cajera
    if (pin === pinesConfig.pinCajero || pin === DEFAULT_PINES.pinCajero) {
      const cajeroUser: AppUser = {
        uid: 'pin-cajero-pos',
        email: 'cajero@bibistore.com',
        displayName: 'Cajera Bibi Store',
        authMethod: 'pin'
      };
      setUser(cajeroUser);
      setRole('cajero');
      try {
        localStorage.setItem('bibi_store_session', JSON.stringify({ user: cajeroUser, role: 'cajero' }));
      } catch {}
      return { success: true, role: 'cajero' };
    }

    // 4. Comprobar si es un Token de un solo uso en la colección 'codigos'
    try {
      const codigoRef = doc(db, 'codigos', pin);
      const codigoSnap = await getDoc(codigoRef);
      if (codigoSnap.exists()) {
        const codigoData = codigoSnap.data();
        if (codigoData.usado) {
          return { success: false, message: 'Este código ya fue utilizado.' };
        }

        const rolAsignado = (codigoData.rol as UserRole) || 'cajero';
        const tokenUser: AppUser = {
          uid: `token-${pin}`,
          email: `${rolAsignado}@bibistore.com`,
          displayName: rolAsignado === 'admin' ? 'Dueña (Acceso Token)' : 'Cajera (Acceso Token)',
          authMethod: 'pin'
        };

        // Marcar como usado
        await updateDoc(codigoRef, {
          usado: true,
          usadoPor: tokenUser.uid,
          usadoEn: Date.now()
        }).catch(() => {});

        setUser(tokenUser);
        setRole(rolAsignado);
        try {
          localStorage.setItem('bibi_store_session', JSON.stringify({ user: tokenUser, role: rolAsignado }));
        } catch {}
        return { success: true, role: rolAsignado };
      }
    } catch (err) {
      console.warn("Error verificando token en Firestore:", err);
    }

    return { success: false, message: 'PIN o código incorrecto. Verifica e intenta nuevamente.' };
  };

  const logout = () => {
    localStorage.removeItem('bibi_store_session');
    setUser(null);
    setRole('none');
    fbSignOut(auth).catch(() => {});
  };

  const actualizarPines = async (nuevosPines: Partial<PinesSeguridad>): Promise<boolean> => {
    try {
      const dataToSave = {
        ...pinesConfig,
        ...nuevosPines
      };
      await setDoc(doc(db, 'configuracion', 'seguridad'), dataToSave, { merge: true });
      setPinesConfig(dataToSave);
      return true;
    } catch (err) {
      console.error("Error guardando nuevos PINs:", err);
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, loginWithPin, logout, pinesConfig, actualizarPines }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
