import { Outlet, Link, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useConfig } from "../contexts/ConfigContext";
import { signOut } from "../lib/firebase";
import { Store, ShoppingCart, Users, Settings, Package, LogOut, FileText, ShieldAlert, WifiOff } from "lucide-react";
import { cn } from "../lib/utils";
import React, { useEffect, useState } from "react";
import BibiStoreLogo from "./BibiStoreLogo";

export default function Layout() {
  const { role, user, logout } = useAuth();
  const { tasaDolar } = useConfig();
  const location = useLocation();
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setOffline(false);
    const handleOffline = () => setOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const navItems = [
    { name: 'Vender', path: '/', icon: ShoppingCart, roles: ['superadmin', 'admin', 'cajero'] },
    { name: 'Catálogo', path: '/inventario', icon: Package, roles: ['superadmin', 'admin', 'cajero'] },
    { name: 'Fiados', path: '/fiados', icon: Users, roles: ['superadmin', 'admin'] },
    { name: 'Estadísticas', path: '/stats', icon: FileText, roles: ['superadmin', 'admin'] },
    { name: 'Ajustes', path: '/ajustes', icon: Settings, roles: ['superadmin', 'admin', 'cajero'] },
    { name: 'Panel Creador', path: '/panel-creador', icon: ShieldAlert, roles: ['superadmin'] },
  ];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white">
      {/* Top Navbar */}
      <header className="bg-black text-white p-4 flex justify-between items-center shadow-lg shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-white rounded p-1 flex items-center justify-center">
            <BibiStoreLogo className="h-10 w-10 sm:h-12 sm:w-12" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tighter leading-none text-white">
              BIBI STORE
            </h1>
            <p className="text-[10px] sm:text-xs text-gray-400 tracking-wide mt-1">Control de Inventario & Ventas</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-4 sm:space-x-6">
          {offline && (
            <div className="flex items-center gap-2 bg-red-600 px-3 py-1 animate-pulse border border-white">
              <WifiOff size={14} className="text-white" />
              <span className="text-[10px] font-black uppercase text-white hidden sm:inline">Offline</span>
            </div>
          )}
          
          <div className="hidden sm:flex bg-zinc-800 px-3 py-1 rounded-sm border border-zinc-700 flex-col items-center">
            <span className="text-[10px] uppercase text-gray-400 font-bold tracking-widest">Tasa del Día</span>
            <span className="font-mono font-bold text-yellow-400">1 USD = {tasaDolar || '---'} VED</span>
          </div>
          
          <div className="flex items-center space-x-3 sm:border-l sm:border-zinc-700 sm:pl-6">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-bold truncate max-w-[120px]">{user?.displayName || 'Usuario'}</p>
              <p className="text-[10px] text-yellow-400 uppercase tracking-widest font-black">{role}</p>
            </div>
            {/* Minimal Avatar */}
            <div className="w-10 h-10 rounded-full bg-yellow-400 flex items-center justify-center text-black font-extrabold text-lg uppercase shadow-inner border border-yellow-500">
              {user?.email?.[0] || 'U'}
            </div>
            <button 
              onClick={logout}
              className="text-gray-400 hover:text-white p-2 flex items-center justify-center transition-colors ml-2 cursor-pointer"
              title="Cerrar sesión"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden flex-col md:flex-row">
        
        {/* Main View */}
        <main className="flex-1 flex overflow-hidden flex-col">
          <Outlet />
        </main>

        {/* Sidebar / Bottom Navigation Container */}
        {/* Reusing Bottom Navigation for mobile, Sidebar for Desktop */}
      </div>
      
      {/* Universal Navigation (Bottom on Mobile, Left/Right handling via CSS if we want, but letting bottom nav be the primary like the HTML mockup suggests, wait HTML had side nav? No, HTML had Bottom/Top Nav or similar. Ah, HTML had: nav class="bg-white border-t border-gray-200 h-16 flex items-center justify-center space-x-12" at the END of flex-col h-screen, which means bottom navbar. So let's stick to bottom naval for all screens, or keep the desktop sidebar. Actually the aesthetic HTML uses a bottom navbar. Let's convert to bottom navbar exclusively for that minimalist look.) */}
      
      <nav className="bg-white border-t border-gray-200 h-16 flex items-center justify-around sm:justify-center sm:space-x-12 shrink-0 z-20">
        {navItems.filter(i => i.roles.includes(role)).map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          return (
            <Link 
              key={item.path} 
              to={item.path}
              className={cn(
                "flex flex-col items-center justify-center w-16 sm:w-20 transition-all font-bold group",
                isActive ? "text-black" : "text-gray-400 hover:text-black"
              )}
            >
              <Icon size={22} className={cn("transition-transform", isActive ? "scale-110" : "group-hover:scale-110")} />
              <span className={cn(
                "text-[9px] sm:text-[10px] mt-1.5 uppercase tracking-widest",
                isActive ? "text-black" : "text-gray-400 group-hover:text-black"
              )}>{item.name}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  );
}
