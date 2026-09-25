import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { useConfig } from '../contexts/ConfigContext';
import { Settings, Save, Download, Copy, FileCode, X, Check, Database, UploadCloud, RefreshCw, AlertCircle, CheckCircle2, Server, Terminal, ExternalLink, ShieldCheck, Globe } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { exportarProductosJSON, descargarJSON, ProductoExportJSON } from '../lib/exportProductos';
import { handleAutomatedMigration, handleDirectJSONImportToSupabase, generateSQLFromJSON, MigrationProgress } from '../lib/supabaseMigration';
import { checkVPSOnline, migrarTodoAVPS, VPSStatus } from '../lib/vpsService';
import VpsRestoreBackupCard from '../components/VpsRestoreBackupCard';

export default function Ajustes() {
  const { tasaDolar, actualizarTasa } = useConfig();
  const { role } = useAuth();
  const [nuevaTasa, setNuevaTasa] = useState('');
  const [guardando, setGuardando] = useState(false);
  
  const [exportando, setExportando] = useState(false);
  const [exportData, setExportData] = useState<ProductoExportJSON[] | null>(null);
  const [modalExportAbierto, setModalExportAbierto] = useState(false);
  const [copiado, setCopiado] = useState(false);

  // Estados para VPS Autónomo
  const [vpsStatus, setVpsStatus] = useState<VPSStatus>({ online: false });
  const [migrandoVPS, setMigrandoVPS] = useState(false);
  const [copiadoComandoActivarBackend, setCopiadoComandoActivarBackend] = useState(false);

  // Estados para Migración Automática y JSON Supabase
  const [supabaseUrl, setSupabaseUrl] = useState(() => 
    import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('supabase_mig_url') || ''
  );
  const [supabaseKey, setSupabaseKey] = useState(() => 
    import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('supabase_mig_key') || ''
  );
  const [migrando, setMigrando] = useState(false);
  const [progresoMigracion, setProgresoMigracion] = useState<MigrationProgress | null>(null);
  const [migracionExito, setMigracionExito] = useState<string | null>(null);
  const [migracionError, setMigracionError] = useState<string | null>(null);

  // Estados para Despliegue en VPS (DigitalOcean)
  const [vpsIp, setVpsIp] = useState('143.198.163.70');
  const [githubRepo, setGithubRepo] = useState(() => 
    localStorage.getItem('bibi_vps_repo') || 'Tecnomundo235/Server-3'
  );
  const [copiadoVpsSsh, setCopiadoVpsSsh] = useState(false);
  const [copiadoVpsScript, setCopiadoVpsScript] = useState(false);
  const [copiadoVpsComandoDirecto, setCopiadoVpsComandoDirecto] = useState(false);

  const handleRepoChange = (repo: string) => {
    setGithubRepo(repo);
    localStorage.setItem('bibi_vps_repo', repo);
    toast.success(`Repositorio configurado a ${repo}`);
  };

  // Generador de SQL / Importación JSON
  const [jsonPastedText, setJsonPastedText] = useState('');
  const [sqlGenerado, setSqlGenerado] = useState<string | null>(null);
  const [modalSqlAbierto, setModalSqlAbierto] = useState(false);
  const [sqlCopiado, setSqlCopiado] = useState(false);

  useEffect(() => {
    if (tasaDolar) {
      setNuevaTasa(tasaDolar.toString());
    }
  }, [tasaDolar]);

  useEffect(() => {
    checkVPSOnline().then(setVpsStatus);
    const interval = setInterval(() => {
      checkVPSOnline().then(setVpsStatus);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  const handleMigrarAVPS = async () => {
    setMigrandoVPS(true);
    const loadingToast = toast.loading("Preparando 710 productos y enviando a la VPS...");
    try {
      let prods: any[] = [];
      const cached = localStorage.getItem('bibi_store_cached_productos');
      if (cached) {
        try { prods = JSON.parse(cached); } catch {}
      }

      if (prods.length === 0) {
        prods = await exportarProductosJSON();
      }

      if (prods.length === 0) {
        throw new Error("No hay productos cargados en memoria. Abre la pantalla de Inventario primero.");
      }

      const res = await migrarTodoAVPS({
        productos: prods,
        config: { tasa_dolar: Number(nuevaTasa) || tasaDolar || 50 }
      });

      toast.success(`🎉 ¡Migración Perfecta! ${res.totalProductos} productos guardados en el disco de tu VPS.`, {
        id: loadingToast,
        duration: 8000
      });
      checkVPSOnline().then(setVpsStatus);
    } catch (err: any) {
      console.error("Error migrando a VPS:", err);
      toast.error(err.message || "Error al migrar a la VPS. Asegúrate de haber ejecutado el script en la consola.", {
        id: loadingToast,
        duration: 7000
      });
    } finally {
      setMigrandoVPS(false);
    }
  };

  const handleSubirCopiaJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const toastId = toast.loading("Restaurando catálogo desde archivo JSON...");
    try {
      const text = await file.text();
      let parsed = JSON.parse(text);
      let prods: any[] = [];
      if (Array.isArray(parsed)) {
        prods = parsed;
      } else if (parsed && Array.isArray(parsed.productos)) {
        prods = parsed.productos;
      } else {
        throw new Error("El archivo no contiene una lista de productos válida.");
      }

      if (prods.length === 0) {
        throw new Error("El archivo JSON no contiene productos.");
      }

      try {
        localStorage.setItem('bibi_store_cached_productos', JSON.stringify(prods));
      } catch {}

      const res = await migrarTodoAVPS({
        productos: prods,
        config: { tasa_dolar: Number(nuevaTasa) || tasaDolar || 50 }
      });

      toast.success(`🎉 ¡Restauración completa! ${res.totalProductos || prods.length} productos guardados en tu VPS y en este navegador.`, { id: toastId, duration: 8000 });
      checkVPSOnline().then(setVpsStatus);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Error al procesar el archivo JSON", { id: toastId });
    }
  };

  const guardarAjustes = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    const loadingToast = toast.loading("Actualizando tasa oficial...");
    try {
      const val = Number(nuevaTasa);
      if (!val || val <= 0) {
        toast.error("Por favor ingresa una tasa válida mayor a 0", { id: loadingToast });
        return;
      }
      await actualizarTasa(val);
      toast.success(`🎉 Tasa oficial actualizada a Bs. ${val}`, { id: loadingToast });
    } catch (err) {
      console.error(err);
      toast.error("Error al actualizar la tasa", { id: loadingToast });
    } finally {
      setGuardando(false);
    }
  };

  const handleExportarJSON = async () => {
    setExportando(true);
    const loadingToast = toast.loading("Exportando catálogo completo con fotos y costos...");
    try {
      let cached: any[] | undefined;
      try {
        const s = localStorage.getItem('bibi_store_cached_productos');
        if (s) cached = JSON.parse(s);
      } catch {}
      const data = await exportarProductosJSON(cached);
      setExportData(data);
      descargarJSON(data, 'bibi_store_productos_completos.json');
      console.log("=== RESULTADO EXPORTACIÓN PRODUCTOS ===");
      console.log(JSON.stringify(data, null, 2));
      toast.success(`¡Exportados ${data.length} productos con fotos y costos!`, { id: loadingToast, duration: 5000 });
      setModalExportAbierto(true);
    } catch (err: any) {
      console.error("Error en handleExportarJSON:", err);
      const errMsg = err?.message || "Error al exportar productos";
      toast.error(errMsg, { id: loadingToast });
    } finally {
      setExportando(false);
    }
  };

  const handleEjecutarMigracionSupabase = async () => {
    if (!supabaseUrl.trim() || !supabaseKey.trim()) {
      toast.error("Por favor ingresa la URL y API Key de Supabase.");
      return;
    }

    // Guardar credenciales en localStorage para conveniencia del usuario
    localStorage.setItem('supabase_mig_url', supabaseUrl.trim());
    localStorage.setItem('supabase_mig_key', supabaseKey.trim());

    setMigrando(true);
    setMigracionError(null);
    setMigracionExito(null);
    setProgresoMigracion({ current: 0, total: 0, statusText: 'Iniciando migración...', percent: 0 });

    const toastId = toast.loading("Iniciando migración a Supabase...");

    try {
      const res = await handleAutomatedMigration(
        supabaseUrl.trim(),
        supabaseKey.trim(),
        Number(nuevaTasa) || tasaDolar || 1,
        (progress) => {
          setProgresoMigracion(progress);
        }
      );

      const msj = `¡Migración completada con éxito! Se procesaron ${res.totalMigrados} productos en Supabase.`;
      setMigracionExito(msj);
      toast.success(msj, { id: toastId, duration: 6000 });
    } catch (err: any) {
      console.error("Error en migración a Supabase:", err);
      const errorMsg = err?.message || "Error desconocido al migrar a Supabase.";
      setMigracionError(errorMsg);
      toast.error(`Error al migrar catálogo: ${errorMsg}`, { id: toastId, duration: 8000 });
    } finally {
      setMigrando(false);
    }
  };

  const parseJsonSource = (): any[] => {
    let sourceData = exportData;
    if (jsonPastedText.trim()) {
      try {
        sourceData = JSON.parse(jsonPastedText.trim());
      } catch (err) {
        throw new Error("El texto del JSON no es un formato válido. Revisa el contenido.");
      }
    }
    if (!sourceData || !Array.isArray(sourceData) || sourceData.length === 0) {
      throw new Error("No hay datos JSON cargados. Pega el JSON o sube el archivo productos.json.");
    }
    return sourceData;
  };

  const handleGenerarSQLScript = () => {
    try {
      const data = parseJsonSource();
      const sql = generateSQLFromJSON(data, Number(nuevaTasa) || tasaDolar || 1);
      setSqlGenerado(sql);
      setModalSqlAbierto(true);
      toast.success(`Script SQL generado para ${data.length} productos`);
    } catch (err: any) {
      toast.error(err.message || "Error al generar SQL");
    }
  };

  const handleFileUploadJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (text) {
        setJsonPastedText(text);
        toast.success(`Archivo "${file.name}" cargado (${text.length} caracteres)`);
      }
    };
    reader.readAsText(file);
  };

  const handleImportarJSONDirecto = async () => {
    if (!supabaseUrl.trim() || !supabaseKey.trim()) {
      toast.error("Por favor ingresa la URL y API Key de Supabase.");
      return;
    }
    try {
      const data = parseJsonSource();
      setMigrando(true);
      setMigracionError(null);
      setMigracionExito(null);
      
      const toastId = toast.loading(`Importando ${data.length} productos directamente a Supabase...`);
      const res = await handleDirectJSONImportToSupabase(
        supabaseUrl.trim(),
        supabaseKey.trim(),
        data,
        Number(nuevaTasa) || tasaDolar || 1,
        (p) => setProgresoMigracion(p)
      );

      const msj = `¡Importación completada! Se insertaron/actualizaron ${res.totalMigrados} productos en Supabase.`;
      setMigracionExito(msj);
      toast.success(msj, { id: toastId, duration: 6000 });
    } catch (err: any) {
      console.error(err);
      const errMsg = err?.message || "Error al importar JSON a Supabase";
      setMigracionError(errMsg);
      toast.error(errMsg);
    } finally {
      setMigrando(false);
    }
  };

  const copiarAlPortapapeles = () => {
    if (!exportData) return;
    navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
    setCopiado(true);
    toast.success("JSON copiado al portapapeles");
    setTimeout(() => setCopiado(false), 2000);
  };

  const copiarSqlAlPortapapeles = () => {
    if (!sqlGenerado) return;
    navigator.clipboard.writeText(sqlGenerado);
    setSqlCopiado(true);
    toast.success("Script SQL copiado al portapapeles!");
    setTimeout(() => setSqlCopiado(false), 2000);
  };

  const copiarTexto = (texto: string, setEstado: (v: boolean) => void, mensaje: string) => {
    navigator.clipboard.writeText(texto);
    setEstado(true);
    toast.success(mensaje);
    setTimeout(() => setEstado(false), 2000);
  };

  const descargarArchivoTexto = (nombre: string, contenido: string, tipo = 'text/plain') => {
    const blob = new Blob([contenido], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Descargado ${nombre}`);
  };

  const getDeployScriptContent = () => `#!/usr/bin/env bash
# SCRIPT DE DESPLIEGUE AUTOMÁTICO DE BIBI STORE EN DIGITALOCEAN
# IP: ${vpsIp}
# Repositorio: ${githubRepo}
set -e
if [ "$EUID" -ne 0 ]; then echo "Ejecuta como root (o sudo)"; exit 1; fi

# 1. Swap de 1GB para evitar out-of-memory en 1GB RAM
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 2. Actualizar sistema e instalar Node.js 20 y Nginx
apt-get update -y && apt-get install -y curl git ufw nginx unzip
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs

# 3. Cortafuegos UFW
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable || true

# 4. Clonar o actualizar repositorio
mkdir -p /var/www/bibi-store
if [ ! -d "/var/www/bibi-store/.git" ]; then
  git clone https://github.com/${githubRepo}.git /var/www/bibi-store
else
  cd /var/www/bibi-store && git pull || true
fi

# 5. Compilar y publicar aplicación
cd /var/www/bibi-store
if [ -f "package.json" ]; then
  export NODE_OPTIONS="--max-old-space-size=768"
  npm install --no-audit --no-fund || npm install --legacy-peer-deps || true
  npm run build
fi

# 6. Configurar Nginx para SPA (React Router y PWA)
cat << 'EOF' > /etc/nginx/sites-available/bibi-store
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${vpsIp} _;
    root /var/www/bibi-store/dist;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript image/svg+xml;

    location ~* \\.(?:ico|css|js|gif|jpe?g|png|woff2?|svg)$ {
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    location ~* (sw\\.js|registerSW\\.js|manifest\\.webmanifest|index\\.html)$ {
        expires -1;
        add_header Cache-Control "no-store, no-cache";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/bibi-store /etc/nginx/sites-enabled/
chown -R www-data:www-data /var/www/bibi-store/dist || true
chmod -R 755 /var/www/bibi-store/dist || true
nginx -t && systemctl restart nginx && systemctl enable nginx

echo "========================================================="
echo "¡Bibi Store activo y en línea en http://${vpsIp}!"
echo "Recuerda autorizar ${vpsIp} en Firebase Console > Authentication > Authorized domains"
echo "========================================================="
`;

  const getNginxConfContent = () => `server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${vpsIp} localhost;

    root /var/www/bibi-store/dist;
    index index.html;

    gzip on;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml image/svg+xml;

    location ~* \\.(?:ico|css|js|gif|jpe?g|png|woff2?|svg)$ {
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    location ~* (sw\\.js|registerSW\\.js|manifest\\.webmanifest|index\\.html)$ {
        expires -1;
        add_header Cache-Control "no-store, no-cache";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
`;

  const deployCommand = `curl -fsSL https://raw.githubusercontent.com/${githubRepo}/main/public/actualizar.sh | bash`;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white max-w-4xl mx-auto w-full border-x-0 sm:border-x-2 border-black overflow-y-auto overflow-x-hidden pb-28">
      {/* Encabezado fijo superior */}
      <div className="p-3.5 sm:p-5 border-b-2 border-black flex items-center justify-between gap-3 bg-gray-50 sticky top-0 z-10 shrink-0">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <div className="p-2 sm:p-2.5 bg-yellow-400 border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] shrink-0">
            <Settings size={22} className="text-black" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-2xl font-black uppercase tracking-tight text-black truncate">Ajustes del Sistema</h1>
            <p className="text-[10px] sm:text-xs font-mono text-gray-500 uppercase tracking-wider truncate">Configuración general de Bibi Store</p>
          </div>
        </div>
      </div>

      <div className="p-3 sm:p-6 space-y-5 sm:space-y-6 flex-1">
        {/* Tasa de Cambio */}
        <form onSubmit={guardarAjustes} className="bg-white border-2 sm:border-4 border-black p-3.5 sm:p-5 shadow-[3px_3px_0px_rgba(0,0,0,1)] sm:shadow-[6px_6px_0px_rgba(0,0,0,1)] relative max-w-full overflow-hidden">
          <label className="block text-base sm:text-xl font-extrabold text-black mb-1 sm:mb-2 uppercase tracking-tight">Tasa de Cambio (VED)</label>
          <p className="text-[10px] sm:text-xs font-mono text-gray-500 mb-4 sm:mb-6 uppercase tracking-widest">Esta tasa se usará en toda la aplicación para calcular los precios en Bolívares.</p>
          
          <div className="flex flex-col sm:flex-row items-end gap-3 sm:gap-4">
            <div className="flex-1 w-full">
              <label className="block text-[10px] font-black uppercase tracking-widest text-black mb-1">Valor Oficial / USD</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-gray-400">Bs.</span>
                <input 
                  type="number" 
                  step="0.01" 
                  min="1"
                  required
                  value={nuevaTasa}
                  onChange={e => setNuevaTasa(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 sm:py-4 text-lg sm:text-xl font-mono font-bold border-2 border-black rounded-none focus:outline-none focus:border-yellow-400 bg-gray-50 transition-colors"
                />
              </div>
            </div>
            <button 
              type="submit" 
              disabled={guardando || !nuevaTasa || Number(nuevaTasa) <= 0}
              className="w-full sm:w-auto bg-black text-white hover:bg-yellow-400 hover:text-black border-2 border-black disabled:bg-gray-400 font-bold px-6 sm:px-8 py-3.5 sm:py-4 uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-xs sm:text-sm"
            >
              {guardando ? (
                <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <><Save size={18} /> Guardar</>
              )}
            </button>
          </div>
        </form>

        {/* VPS DigitalOcean Migration & Deployment Section */}
        <section className="bg-gradient-to-br from-emerald-50 to-teal-50 border-2 sm:border-4 border-black p-3 sm:p-5 flex flex-col gap-4 sm:gap-5 shadow-[3px_3px_0px_rgba(0,0,0,1)] sm:shadow-[6px_6px_0px_rgba(0,0,0,1)] relative max-w-full overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b-2 border-black pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 sm:p-2.5 bg-emerald-500 text-white border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] shrink-0">
                <Server size={22} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base sm:text-xl font-black uppercase tracking-tight text-black">
                    Despliegue en VPS DigitalOcean
                  </h2>
                  <span className="bg-emerald-600 text-white text-[9px] font-black px-1.5 py-0.5 uppercase tracking-widest border border-black">
                    Droplet Activo
                  </span>
                </div>
                <p className="text-[10px] sm:text-xs font-mono text-gray-700 uppercase tracking-wider mt-0.5 truncate">
                  Ubuntu 24.04 (LTS) x64 • IP: {vpsIp}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-[10px] font-black uppercase tracking-widest text-black">IP VPS:</label>
              <input 
                type="text"
                value={vpsIp}
                onChange={e => setVpsIp(e.target.value)}
                className="px-2 py-1 border-2 border-black font-mono text-xs font-bold bg-white focus:outline-none w-36"
                placeholder="143.198.163.70"
              />
            </div>
          </div>

          {/* Selector y Sincronizador de Repositorio GitHub */}
          <div className="bg-white border-2 border-black p-3 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="text-[11px] font-black uppercase tracking-wider text-black flex items-center gap-1.5">
                <Terminal size={14} className="text-emerald-600" /> Repositorio GitHub para tu VPS:
              </span>
              <span className="text-[10px] font-mono text-gray-500">
                Selecciona tu repositorio activo
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleRepoChange('Tecnomundo235/Server-3')}
                className={`px-2.5 py-2 text-left border-2 border-black text-xs font-mono font-bold transition-all flex items-center justify-between ${
                  githubRepo === 'Tecnomundo235/Server-3'
                    ? 'bg-black text-white'
                    : 'bg-gray-50 hover:bg-yellow-200 text-black'
                }`}
              >
                <span className="truncate">Tecnomundo235/Server-3 (Recomendado)</span>
                {githubRepo === 'Tecnomundo235/Server-3' && <Check size={14} className="text-yellow-400 shrink-0 ml-1" />}
              </button>
              <button
                type="button"
                onClick={() => handleRepoChange('monetizacionreymonfr2-max/Bibi-Store')}
                className={`px-2.5 py-2 text-left border-2 border-black text-xs font-mono font-bold transition-all flex items-center justify-between ${
                  githubRepo === 'monetizacionreymonfr2-max/Bibi-Store'
                    ? 'bg-black text-white'
                    : 'bg-gray-50 hover:bg-yellow-200 text-black'
                }`}
              >
                <span className="truncate">monetizacionreymonfr2-max/Bibi-Store</span>
                {githubRepo === 'monetizacionreymonfr2-max/Bibi-Store' && <Check size={14} className="text-yellow-400 shrink-0 ml-1" />}
              </button>
            </div>
          </div>

          {/* PANEL DE MIGRACIÓN AUTÓNOMA 1-CLIC */}
          <div className="bg-white border-2 sm:border-4 border-black p-3 sm:p-5 shadow-[2px_2px_0px_rgba(0,0,0,1)] sm:shadow-[4px_4px_0px_rgba(0,0,0,1)] space-y-3.5 max-w-full overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b-2 border-black pb-2.5">
              <div>
                <span className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-emerald-700 block">
                  ★ MIGRACIÓN DEFINITIVA A LA VPS (SIN LÍMITES)
                </span>
                <h3 className="text-sm sm:text-base font-black uppercase tracking-tight text-black mt-0.5">
                  Hacer Bibi Store 100% Independiente de Firebase
                </h3>
              </div>
              <div>
                {vpsStatus.online ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-100 text-emerald-800 border-2 border-emerald-600 font-mono text-[10px] sm:text-xs font-black uppercase">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    Backend VPS Activo ({vpsStatus.totalProductos ?? 0} prods)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-100 text-amber-800 border-2 border-amber-600 font-mono text-[10px] sm:text-xs font-bold uppercase">
                    <AlertCircle size={12} /> Backend VPS en Reposo
                  </span>
                )}
              </div>
            </div>

            <p className="text-[11px] sm:text-xs font-mono text-gray-700 leading-relaxed">
              Este botón transfiere todos tus <strong>710 productos</strong> (con fotos, precios de venta, costos en dólares, existencias y códigos de barra) directamente al disco duro de tu VPS. Bibi Store funcionará con su propio motor local a máxima velocidad y sin depender de cuotas de Firebase.
            </p>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <button
                type="button"
                onClick={handleMigrarAVPS}
                disabled={migrandoVPS}
                className="flex-1 bg-emerald-600 hover:bg-black text-white font-black py-3 px-4 border-2 border-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-all shadow-[2px_2px_0px_rgba(0,0,0,1)] disabled:opacity-50"
              >
                {migrandoVPS ? (
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <UploadCloud size={16} />
                )}
                <span>{migrandoVPS ? "Sincronizando con VPS..." : "🚀 Sincronizar Catálogo con VPS"}</span>
              </button>

              <button
                type="button"
                onClick={handleExportarJSON}
                disabled={exportando}
                className="bg-black hover:bg-yellow-400 hover:text-black text-white font-bold py-3 px-4 border-2 border-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-all shadow-[2px_2px_0px_rgba(0,0,0,1)] disabled:opacity-50 whitespace-nowrap"
                title="Descargar copia de seguridad completa con fotos y costos"
              >
                <Download size={16} />
                <span>💾 Descargar Copia (JSON)</span>
              </button>
            </div>

            {/* Opción Directa: Cargar archivo de respaldo JSON para independizar la VPS por Lotes */}
            <VpsRestoreBackupCard
              endpoint="/api/vps/restore-chunk"
              tasaDolar={Number(nuevaTasa) || tasaDolar || 50}
              onSuccess={(stats) => {
                toast.success(`🎉 ¡Restauración exitosa! ${stats.totalItems} productos guardados en VPS. (${stats.imagesDecoupledCount} fotos desacopladas a disco)`, { duration: 7000 });
                checkVPSOnline().then(setVpsStatus);
              }}
            />

            {/* Comando para activar el backend y actualizar en la VPS */}
            <div className="bg-gray-900 text-gray-100 p-3 font-mono text-xs border-2 border-black space-y-2 mt-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                <span className="text-emerald-400 font-bold flex items-center gap-1.5 text-[11px] sm:text-xs">
                  <Terminal size={14} /> Sincronizar Droplet con {githubRepo}:
                </span>
                <button
                  type="button"
                  onClick={() => copiarTexto(
                    deployCommand,
                    setCopiadoComandoActivarBackend,
                    "¡Comando copiado!"
                  )}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center gap-1 self-start sm:self-auto"
                >
                  {copiadoComandoActivarBackend ? <Check size={12} /> : <Copy size={12} />}
                  {copiadoComandoActivarBackend ? "Copiado" : "Copiar"}
                </button>
              </div>
              <div className="text-yellow-300 break-all select-all font-bold text-[11px] sm:text-xs bg-black/50 p-2 border border-gray-700">
                {deployCommand}
              </div>
            </div>
          </div>

          {/* Especificaciones y optimización de memoria */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="bg-white border-2 border-black p-3">
              <span className="text-[10px] font-black uppercase text-gray-500 block">Arquitectura</span>
              <span className="text-xs font-bold font-mono text-black">Nginx SPA + React PWA</span>
              <p className="text-[10px] text-gray-500 mt-0.5">Usa solo ~15MB RAM en tu droplet de 1GB.</p>
            </div>
            <div className="bg-white border-2 border-black p-3">
              <span className="text-[10px] font-black uppercase text-gray-500 block">Memoria Swap</span>
              <span className="text-xs font-bold font-mono text-emerald-700">1GB Swap Automático</span>
              <p className="text-[10px] text-gray-500 mt-0.5">Garantiza compilación sin saturar la RAM.</p>
            </div>
            <div className="bg-white border-2 border-black p-3">
              <span className="text-[10px] font-black uppercase text-gray-500 block">Seguridad & Red</span>
              <span className="text-xs font-bold font-mono text-black">Firewall UFW (80, 443, 22)</span>
              <p className="text-[10px] text-gray-500 mt-0.5">Puertos web abiertos y SSH protegido.</p>
            </div>
          </div>

          {/* Pasos de instalación */}
          <div className="space-y-3">
            {/* Paso 1: Conexión */}
            <div className="bg-white border-2 border-black p-3 sm:p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 sm:w-6 sm:h-6 bg-black text-white font-black text-[11px] sm:text-xs flex items-center justify-center shrink-0">1</span>
                  <h3 className="text-xs font-black uppercase tracking-wider text-black">Conectarse al Droplet</h3>
                </div>
                <span className="text-[9px] sm:text-[10px] font-mono text-gray-500 uppercase">Web Console o Terminal</span>
              </div>
              <p className="text-[11px] sm:text-xs font-mono text-gray-600">
                En DigitalOcean, haz clic en el botón <strong className="text-black">"Web Console"</strong> de tu droplet, o ejecuta:
              </p>
              <div className="flex items-center justify-between bg-gray-900 text-green-400 p-2 font-mono text-xs border border-black">
                <span className="truncate">ssh root@{vpsIp}</span>
                <button
                  type="button"
                  onClick={() => copiarTexto(`ssh root@${vpsIp}`, setCopiadoVpsSsh, "Comando SSH copiado")}
                  className="ml-2 bg-gray-800 hover:bg-gray-700 text-white px-2 py-1 text-[10px] font-bold uppercase flex items-center gap-1 transition-colors shrink-0"
                >
                  {copiadoVpsSsh ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  {copiadoVpsSsh ? "Copiado" : "Copiar"}
                </button>
              </div>
            </div>

            {/* Paso 2: Script Automático */}
            <div className="bg-white border-2 border-black p-3 sm:p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 sm:w-6 sm:h-6 bg-black text-white font-black text-[11px] sm:text-xs flex items-center justify-center shrink-0">2</span>
                  <h3 className="text-xs font-black uppercase tracking-wider text-black">Comando de Despliegue en la VPS</h3>
                </div>
                <span className="text-[9px] sm:text-[10px] font-mono text-gray-500 uppercase">100% Automático</span>
              </div>
              <p className="text-[11px] sm:text-xs font-mono text-gray-600">
                Copia y pega este comando en la consola de tu VPS para instalar Node.js 20, Nginx, compilar Bibi Store y configurar el servidor web:
              </p>
              
              <div className="bg-gray-900 text-gray-100 p-2.5 sm:p-3 font-mono text-[11px] border border-black space-y-1.5 overflow-x-auto">
                <div className="text-emerald-400 font-bold text-[10px] sm:text-[11px]"># Comando de 1 solo clic (pegar directamente en tu consola):</div>
                <div className="text-yellow-300 break-all select-all font-bold text-[11px] sm:text-xs bg-black/40 p-2 border border-gray-700">
                  {deployCommand}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => copiarTexto(
                    deployCommand,
                    setCopiadoVpsComandoDirecto,
                    "¡Comando copiado!"
                  )}
                  className="w-full sm:w-auto bg-black text-white hover:bg-emerald-600 border-2 border-black font-bold px-3.5 py-2 text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-[2px_2px_0px_rgba(0,0,0,1)]"
                >
                  {copiadoVpsComandoDirecto ? <Check size={14} /> : <Copy size={14} />}
                  {copiadoVpsComandoDirecto ? "¡Copiado!" : "Copiar Comando de 1 Clic"}
                </button>

                <button
                  type="button"
                  onClick={() => descargarArchivoTexto('deploy-vps.sh', getDeployScriptContent(), 'application/x-sh')}
                  className="flex-1 sm:flex-none bg-white text-black hover:bg-black hover:text-white border-2 border-black font-bold px-3 py-2 text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
                >
                  <Download size={14} /> deploy-vps.sh
                </button>

                <button
                  type="button"
                  onClick={() => descargarArchivoTexto('nginx.conf', getNginxConfContent(), 'text/plain')}
                  className="flex-1 sm:flex-none bg-white text-black hover:bg-black hover:text-white border-2 border-black font-bold px-3 py-2 text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
                >
                  <Download size={14} /> nginx.conf
                </button>
              </div>
            </div>

            {/* Paso 3: Autorizar Dominio en Firebase */}
            <div className="bg-amber-50 border-2 border-amber-600 p-3 sm:p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 sm:w-6 sm:h-6 bg-amber-600 text-white font-black text-[11px] sm:text-xs flex items-center justify-center shrink-0">3</span>
                <h3 className="text-xs font-black uppercase tracking-wider text-amber-950 flex items-center gap-1.5">
                  <ShieldCheck size={16} className="text-amber-700 shrink-0" />
                  Autorizar la IP en Firebase Authentication
                </h3>
              </div>
              <p className="text-[11px] sm:text-xs font-mono text-amber-900 leading-relaxed">
                Para que el inicio de sesión con Google funcione en tu VPS sin error <code className="bg-white px-1 border border-amber-400 font-bold">auth/unauthorized-domain</code>:
              </p>
              <ol className="list-decimal list-inside text-[11px] sm:text-xs font-mono text-amber-950 space-y-1 pl-1">
                <li>Abre Firebase Console.</li>
                <li>Dirígete a <strong>Authentication → Ajustes (Settings) → Dominios Autorizados</strong>.</li>
                <li>Haz clic en <strong>Agregar dominio</strong> y escribe: <code className="bg-white px-1.5 py-0.5 border border-black font-bold text-black">{vpsIp}</code></li>
              </ol>
              <div className="pt-1">
                <a
                  href="https://console.firebase.google.com/project/gen-lang-client-0621684486/authentication/settings"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 bg-amber-600 text-white hover:bg-black px-3 py-1.5 text-xs font-bold uppercase tracking-wider border border-black transition-colors"
                >
                  Abrir Ajustes de Firebase <ExternalLink size={14} />
                </a>
              </div>
            </div>

            {/* Paso 4: Acceso Final */}
            <div className="bg-white border-2 border-black p-3 sm:p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="w-full sm:w-auto">
                <h4 className="text-xs font-black uppercase tracking-wider text-black flex items-center gap-1.5">
                  <Globe size={16} className="text-emerald-600 shrink-0" />
                  Tu URL de Acceso en la VPS:
                </h4>
                <p className="text-[11px] sm:text-xs font-mono text-gray-600 mt-0.5">
                  Una vez completado el script, tu tienda estará disponible en:
                </p>
              </div>
              <a
                href={`http://${vpsIp}`}
                target="_blank"
                rel="noreferrer"
                className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 font-black text-xs uppercase tracking-widest border-2 border-black flex items-center justify-center gap-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] transition-all"
              >
                Abrir http://{vpsIp} <ExternalLink size={14} />
              </a>
            </div>
          </div>
        </section>

        {/* Automated Migration Section for Supabase */}
        <section className="bg-blue-50 border-2 sm:border-4 border-blue-600 p-3 sm:p-5 flex flex-col gap-4 shadow-[3px_3px_0px_rgba(37,99,235,1)] sm:shadow-[6px_6px_0px_rgba(37,99,235,1)] relative max-w-full overflow-hidden">
          <div className="flex items-center gap-2.5">
            <Database className="text-blue-700 shrink-0" size={24} />
            <div className="min-w-0">
              <h2 className="text-base sm:text-xl font-black uppercase tracking-tight text-black truncate">
                Migración Automática a Supabase
              </h2>
              <p className="text-[10px] sm:text-xs font-mono text-gray-700 uppercase tracking-wider mt-0.5">
                Procesa el catálogo local y lo sube automáticamente a Supabase Storage y Database.
              </p>
            </div>
          </div>

          {/* Inputs de credenciales Supabase */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-white p-3 sm:p-4 border-2 border-black">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-black mb-1">
                Supabase URL
              </label>
              <input 
                type="text"
                placeholder="https://xyzcompany.supabase.co"
                value={supabaseUrl}
                onChange={e => setSupabaseUrl(e.target.value)}
                disabled={migrando}
                className="w-full px-3 py-2 border-2 border-black font-mono text-xs focus:outline-none focus:border-blue-600 bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-black mb-1">
                Supabase Anon / Service Key
              </label>
              <input 
                type="password"
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6Ik..."
                value={supabaseKey}
                onChange={e => setSupabaseKey(e.target.value)}
                disabled={migrando}
                className="w-full px-3 py-2 border-2 border-black font-mono text-xs focus:outline-none focus:border-blue-600 bg-gray-50"
              />
            </div>
          </div>

          {/* Requisitos previos informativos */}
          <div className="text-[10px] sm:text-[11px] font-mono text-gray-700 bg-blue-100/70 p-2.5 sm:p-3 border border-blue-300 space-y-1">
            <p className="font-bold uppercase text-blue-950 flex items-center gap-1">
              <AlertCircle size={14} className="shrink-0" /> Requisitos Previos en Supabase:
            </p>
            <ul className="list-disc list-inside space-y-0.5 pl-1">
              <li><span className="font-bold">Bucket Storage:</span> Bucket público llamado <code className="bg-white px-1 border border-black font-bold">productos</code>.</li>
              <li><span className="font-bold">Tabla DB:</span> Tabla <code className="bg-white px-1 border border-black font-bold">productos</code> con permisos RLS de INSERT/UPDATE.</li>
            </ul>
          </div>

          {/* Barra de Progreso y Estado */}
          {migrando && progresoMigracion && (
            <div className="bg-white border-2 border-black p-3 space-y-2">
              <div className="flex justify-between items-center text-xs font-mono font-black uppercase">
                <span className="text-blue-800 truncate">{progresoMigracion.statusText}</span>
                <span className="bg-blue-600 text-white px-2 py-0.5 font-bold shrink-0">{progresoMigracion.percent}%</span>
              </div>
              <div className="w-full h-4 bg-gray-200 border-2 border-black overflow-hidden relative">
                <div 
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${progresoMigracion.percent}%` }}
                />
              </div>
            </div>
          )}

          {/* Alerta de Éxito o Error */}
          {migracionExito && (
            <div className="p-3 bg-emerald-100 border-2 border-emerald-600 text-emerald-950 text-xs font-mono font-bold flex items-center gap-2">
              <CheckCircle2 className="text-emerald-600 shrink-0" size={18} />
              <span>{migracionExito}</span>
            </div>
          )}

          {migracionError && (
            <div className="p-3 bg-red-100 border-2 border-red-600 text-red-950 text-xs font-mono font-bold flex items-center gap-2">
              <AlertCircle className="text-red-600 shrink-0" size={18} />
              <span>Error al migrar catálogo: {migracionError}</span>
            </div>
          )}

          {/* Botón Principal de Migración */}
          <div className="flex flex-wrap gap-2.5">
            <button 
              type="button"
              disabled={migrando || !supabaseUrl.trim() || !supabaseKey.trim()}
              onClick={handleEjecutarMigracionSupabase}
              className="w-full sm:w-auto bg-blue-600 text-white hover:bg-black hover:text-white border-2 border-black font-black px-6 py-3.5 uppercase tracking-widest flex items-center justify-center gap-2.5 transition-all text-xs sm:text-sm disabled:opacity-50 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5"
            >
              {migrando ? (
                <>
                  <RefreshCw className="animate-spin" size={18} />
                  <span>Migrando Catálogo... ({progresoMigracion?.percent || 0}%)</span>
                </>
              ) : (
                <>
                  <UploadCloud size={18} />
                  <span>Migrar Catálogo a Supabase</span>
                </>
              )}
            </button>
          </div>
        </section>

        {/* Export section for Supabase Migration */}
        <section className="bg-emerald-50 border-2 sm:border-4 border-emerald-600 p-3 sm:p-5 flex flex-col gap-3.5 shadow-[3px_3px_0px_rgba(5,150,105,1)] sm:shadow-[6px_6px_0px_rgba(5,150,105,1)] relative max-w-full overflow-hidden">
          <h2 className="text-base sm:text-xl font-black uppercase tracking-tight text-black flex items-center gap-2">
            <FileCode className="text-emerald-700 shrink-0" size={22} /> Exportar Productos para Supabase
          </h2>
          <p className="text-[10px] sm:text-xs font-mono text-gray-700 uppercase tracking-widest leading-relaxed">
            Obtiene los datos de <code className="bg-white px-1 py-0.5 border border-black font-bold">productos</code> y <code className="bg-white px-1 py-0.5 border border-black font-bold">costos_productos</code> desde Firestore y genera el archivo <code className="bg-white px-1 py-0.5 border border-black font-bold text-emerald-800">productos.json</code> con la estructura exacta:
            <br />
            <span className="font-mono text-[10px] sm:text-[11px] text-emerald-900 font-bold block mt-1">
              [ &#123; id, precio_usd, costo_usd, imagen_url &#125; ]
            </span>
          </p>
          <div className="flex flex-wrap gap-2.5 mt-1">
            <button 
              type="button"
              disabled={exportando}
              onClick={handleExportarJSON}
              className="w-full sm:w-auto bg-black text-white hover:bg-emerald-500 hover:text-black border-2 border-black font-bold px-5 py-3 uppercase tracking-widest flex items-center justify-center gap-2 transition-all text-xs disabled:opacity-50 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5"
            >
              {exportando ? (
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <><Download size={16} /> Exportar y Descargar productos.json</>
              )}
            </button>

            {exportData && (
              <button
                type="button"
                onClick={() => setModalExportAbierto(true)}
                className="w-full sm:w-auto bg-white text-black hover:bg-black hover:text-white border-2 border-black font-bold px-4 py-3 uppercase tracking-widest flex items-center justify-center gap-2 transition-all text-xs"
              >
                Ver / Copiar JSON
              </button>
            )}
          </div>
        </section>

        {/* Section: Cargar productos.json / Generador de Script SQL para Supabase */}
        <section className="bg-purple-50 border-2 sm:border-4 border-purple-600 p-3 sm:p-5 flex flex-col gap-3.5 shadow-[3px_3px_0px_rgba(147,51,234,1)] sm:shadow-[6px_6px_0px_rgba(147,51,234,1)] relative max-w-full overflow-hidden">
          <h2 className="text-base sm:text-xl font-black uppercase tracking-tight text-black flex items-center gap-2">
            <FileCode className="text-purple-700 shrink-0" size={22} /> Generador de Script SQL & Carga de productos.json
          </h2>
          <p className="text-[10px] sm:text-xs font-mono text-gray-700 uppercase tracking-widest leading-relaxed">
            Si la cuota de Firestore se superó o prefieres migrar vía SQL directo sin consumo de API, sube o pega tu archivo <code className="bg-white px-1 border border-black font-bold">productos.json</code> para generar el Script SQL listo para ejecutar en el <strong>Supabase SQL Editor</strong>.
          </p>

          {/* Selector de Archivo o Textarea */}
          <div className="flex flex-col gap-2.5 bg-white p-3 sm:p-4 border-2 border-black">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
              <label className="text-[11px] sm:text-xs font-black uppercase tracking-wider text-black">
                1. Sube tu archivo productos.json:
              </label>
              <input 
                type="file" 
                accept=".json,application/json"
                onChange={handleFileUploadJSON}
                className="text-xs font-mono text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:border-2 file:border-black file:text-xs file:font-bold file:bg-purple-100 file:text-purple-900 hover:file:bg-purple-200 cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-[11px] sm:text-xs font-black uppercase tracking-wider text-black mb-1">
                O Pega el contenido de tu productos.json aquí:
              </label>
              <textarea 
                rows={3}
                placeholder='[ { "id": "prod_1", "precio_usd": 2.50, "costo_usd": 1.20, "imagen_url": "https://..." } ]'
                value={jsonPastedText}
                onChange={e => setJsonPastedText(e.target.value)}
                className="w-full p-2.5 border-2 border-black font-mono text-xs focus:outline-none focus:border-purple-600 bg-gray-50"
              />
            </div>
          </div>

          {/* Botones de acción */}
          <div className="flex flex-wrap gap-2.5 mt-1">
            <button 
              type="button"
              onClick={handleGenerarSQLScript}
              className="w-full sm:w-auto bg-purple-600 text-white hover:bg-black hover:text-white border-2 border-black font-bold px-5 py-3 uppercase tracking-widest flex items-center justify-center gap-2 transition-all text-xs shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5"
            >
              <FileCode size={16} /> Generar Script SQL
            </button>

            <button 
              type="button"
              disabled={migrando || (!supabaseUrl.trim() || !supabaseKey.trim())}
              onClick={handleImportarJSONDirecto}
              className="w-full sm:w-auto bg-black text-white hover:bg-purple-600 hover:text-white border-2 border-black font-bold px-4 py-3 uppercase tracking-widest flex items-center justify-center gap-2 transition-all text-xs disabled:opacity-50"
            >
              <UploadCloud size={16} /> Importar por API
            </button>
          </div>
        </section>
        
        {(role === 'admin' || role === 'superadmin') && (
          <section className="bg-gray-50 border-2 border-dashed border-gray-400 hover:border-black transition-colors p-4 sm:p-5 flex flex-col gap-1.5">
            <h2 className="text-sm sm:text-base font-black uppercase tracking-wider text-black">Opciones de Administrador</h2>
            <p className="text-[11px] sm:text-xs font-mono text-gray-600 uppercase tracking-wider">
              Esta es la vista de opciones avanzadas. El panel creador está disponible en otra pestaña exclusiva.
            </p>
          </section>
        )}

        <section className="bg-yellow-50 border-2 sm:border-4 border-yellow-400 p-3 sm:p-5 flex flex-col gap-3 shadow-[3px_3px_0px_rgba(250,204,21,1)] sm:shadow-[6px_6px_0px_rgba(250,204,21,1)] relative max-w-full overflow-hidden">
           <h2 className="text-base sm:text-xl font-black uppercase tracking-tight text-black flex items-center gap-2">
              🛍️ Catálogo Online
           </h2>
           <p className="text-[10px] sm:text-xs font-mono text-gray-600 uppercase tracking-wider">
              Comparte este enlace con tus clientes para ventas online por WhatsApp.
           </p>
           <div className="flex flex-col sm:flex-row gap-2.5">
             <input 
               readOnly 
               value={`${window.location.origin}/tienda`}
               className="flex-1 bg-white border-2 border-yellow-400 p-2.5 font-mono text-xs sm:text-sm focus:outline-none focus:border-black transition-colors text-black"
             />
             <div className="flex gap-2">
               <button 
                  type="button"
                  onClick={() => {
                     navigator.clipboard.writeText(`${window.location.origin}/tienda`);
                     toast.success("Enlace copiado");
                  }}
                  className="flex-1 sm:flex-none justify-center font-bold px-4 py-2.5 uppercase tracking-wider border-2 border-black bg-white hover:bg-black hover:text-white transition-all text-xs"
               >
                 Copiar
               </button>
               <a 
                 href="/tienda" 
                 target="_blank" 
                 rel="noopener noreferrer"
                 className="flex-1 sm:flex-none flex items-center justify-center font-bold px-4 py-2.5 uppercase tracking-wider border-2 border-black bg-yellow-400 hover:bg-black hover:text-white transition-all text-xs"
               >
                 Abrir
               </a>
             </div>
           </div>
        </section>
      </div>

      {/* Modal Visualizador / Copiador de JSON */}
      {modalExportAbierto && exportData && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white border-4 border-black w-full max-w-3xl max-h-[85vh] flex flex-col shadow-[12px_12px_0px_rgba(0,0,0,1)]">
            <div className="p-4 border-b-2 border-black bg-emerald-400 flex justify-between items-center">
              <h3 className="font-black uppercase tracking-wider text-black flex items-center gap-2">
                <FileCode size={20} /> productos.json ({exportData.length} ítems)
              </h3>
              <button 
                onClick={() => setModalExportAbierto(false)}
                className="bg-black text-white p-1 hover:bg-red-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto bg-gray-900">
              <pre className="font-mono text-xs text-emerald-400 whitespace-pre-wrap break-all leading-relaxed">
                {JSON.stringify(exportData, null, 2)}
              </pre>
            </div>

            <div className="p-4 border-t-2 border-black bg-gray-100 flex flex-wrap gap-3 justify-between items-center">
              <p className="text-xs font-mono text-gray-600 uppercase">
                {exportData.length} productos listos para Supabase
              </p>
              <div className="flex gap-2">
                <button
                  onClick={copiarAlPortapapeles}
                  className="bg-black text-white border-2 border-black px-4 py-2 font-bold uppercase text-xs hover:bg-yellow-400 hover:text-black transition-all flex items-center gap-2"
                >
                  {copiado ? <Check size={16} /> : <Copy size={16} />}
                  {copiado ? "Copiado!" : "Copiar JSON"}
                </button>
                <button
                  onClick={() => descargarJSON(exportData, 'productos.json')}
                  className="bg-emerald-500 text-black border-2 border-black px-4 py-2 font-bold uppercase text-xs hover:bg-black hover:text-white transition-all flex items-center gap-2"
                >
                  <Download size={16} /> Volver a Descargar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Modal Script SQL Generado */}
      {modalSqlAbierto && sqlGenerado && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white border-4 border-black w-full max-w-4xl max-h-[85vh] flex flex-col shadow-[12px_12px_0px_rgba(0,0,0,1)]">
            <div className="p-4 border-b-2 border-black bg-purple-600 text-white flex justify-between items-center">
              <h3 className="font-black uppercase tracking-wider text-white flex items-center gap-2 text-sm sm:text-base">
                <FileCode size={20} /> Script SQL listo para Supabase SQL Editor
              </h3>
              <button 
                onClick={() => setModalSqlAbierto(false)}
                className="bg-black text-white p-1 hover:bg-red-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-3 bg-purple-100 border-b-2 border-black font-mono text-xs text-purple-950 font-bold">
              👉 Instrucciones: Copia este script, abre tu proyecto en <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" className="underline font-black">Supabase Dashboard</a> &gt; <strong>SQL Editor</strong> &gt; <strong>New Query</strong>, pega el contenido y presiona <strong>RUN</strong>.
            </div>

            <div className="p-4 flex-1 overflow-y-auto bg-gray-950 select-all">
              <pre className="font-mono text-xs text-purple-300 whitespace-pre-wrap break-all leading-relaxed">
                {sqlGenerado}
              </pre>
            </div>

            <div className="p-4 border-t-2 border-black bg-gray-100 flex flex-wrap gap-3 justify-between items-center">
              <p className="text-xs font-mono text-gray-700 uppercase font-bold">
                Script generado automáticamente
              </p>
              <div className="flex gap-2">
                <button
                  onClick={copiarSqlAlPortapapeles}
                  className="bg-purple-600 text-white border-2 border-black px-6 py-3 font-bold uppercase text-xs hover:bg-black transition-all flex items-center gap-2 shadow-[2px_2px_0px_rgba(0,0,0,1)]"
                >
                  {sqlCopiado ? <Check size={18} /> : <Copy size={18} />}
                  {sqlCopiado ? "¡Script SQL Copiado!" : "Copiar Script SQL"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

