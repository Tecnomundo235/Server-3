import React, { useState, useRef } from 'react';
import { 
  UploadCloud, 
  CheckCircle2, 
  AlertTriangle, 
  FileJson, 
  RefreshCw, 
  Database, 
  HardDrive, 
  Image as ImageIcon,
  Check, 
  X,
  Layers
} from 'lucide-react';

export type RestoreState = 'idle' | 'validando' | 'subiendo' | 'procesando' | 'completado' | 'error';

export interface BatchStats {
  totalItems: number;
  processedItems: number;
  createdCount: number;
  updatedCount: number;
  imagesDecoupledCount: number;
  currentBatch: number;
  totalBatches: number;
  durationMs: number;
}

interface VpsRestoreBackupCardProps {
  endpoint?: string;
  tasaDolar?: number;
  onSuccess?: (stats: BatchStats) => void;
  className?: string;
}

const BATCH_SIZE = 60; // 60 registros por lote para balance óptimo de velocidad y memoria

export default function VpsRestoreBackupCard({
  endpoint = '/api/vps/restore-chunk',
  tasaDolar = 50,
  onSuccess,
  className = ''
}: VpsRestoreBackupCardProps) {
  const [estado, setEstado] = useState<RestoreState>('idle');
  const [archivoSeleccionado, setArchivoSeleccionado] = useState<File | null>(null);
  const [mensajeEstado, setMensajeEstado] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [stats, setStats] = useState<BatchStats>({
    totalItems: 0,
    processedItems: 0,
    createdCount: 0,
    updatedCount: 0,
    imagesDecoupledCount: 0,
    currentBatch: 0,
    totalBatches: 0,
    durationMs: 0
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<boolean>(false);

  // Calcula el porcentaje exacto de avance
  const porcentaje = stats.totalBatches > 0 
    ? Math.min(100, Math.round((stats.currentBatch / stats.totalBatches) * 100))
    : 0;

  /**
   * Valida y analiza preliminarmente el archivo JSON en el cliente
   */
  const handleFile = async (file: File) => {
    if (!file.name.endsWith('.json')) {
      setErrorMsg('Por favor selecciona un archivo con extensión .json');
      setEstado('error');
      return;
    }

    setArchivoSeleccionado(file);
    setErrorMsg(null);
    setEstado('validando');
    setMensajeEstado(`Leyendo ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)...`);

    try {
      const text = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('El archivo no tiene un formato JSON válido.');
      }

      let productos: any[] = [];
      if (Array.isArray(parsed)) {
        productos = parsed;
      } else if (parsed && Array.isArray(parsed.productos)) {
        productos = parsed.productos;
      } else {
        throw new Error('No se encontró una lista válida de productos en el archivo.');
      }

      if (productos.length === 0) {
        throw new Error('El archivo JSON contiene 0 productos.');
      }

      const totalBatches = Math.ceil(productos.length / BATCH_SIZE);
      setStats({
        totalItems: productos.length,
        processedItems: 0,
        createdCount: 0,
        updatedCount: 0,
        imagesDecoupledCount: 0,
        currentBatch: 0,
        totalBatches,
        durationMs: 0
      });

      setEstado('idle');
      setMensajeEstado(`Listo para restaurar: ${productos.length} productos detectados (${totalBatches} lotes).`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error analizando archivo');
      setEstado('error');
    }
  };

  /**
   * Ejecuta la subida masiva por lotes (Chunks) al servidor
   */
  const iniciarRestauracion = async () => {
    if (!archivoSeleccionado) return;

    cancelRef.current = false;
    setEstado('subiendo');
    setErrorMsg(null);
    const startTime = Date.now();

    try {
      const text = await archivoSeleccionado.text();
      const parsed = JSON.parse(text);
      const productos: any[] = Array.isArray(parsed) ? parsed : parsed.productos;

      const totalBatches = Math.ceil(productos.length / BATCH_SIZE);
      let acumuladoCreated = 0;
      let acumuladoUpdated = 0;
      let acumuladoDecoupled = 0;
      let acumuladoProcessed = 0;

      for (let i = 0; i < totalBatches; i++) {
        if (cancelRef.current) {
          throw new Error('Operación cancelada por el usuario.');
        }

        const chunkIndex = i + 1;
        const start = i * BATCH_SIZE;
        const chunk = productos.slice(start, start + BATCH_SIZE);

        setEstado('procesando');
        setMensajeEstado(`Procesando lote ${chunkIndex} de ${totalBatches} (${chunk.length} productos)...`);

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'chunk',
            batchIndex: chunkIndex,
            totalBatches,
            items: chunk,
            config: { tasa_dolar: tasaDolar }
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: `Error HTTP ${res.status}` }));
          throw new Error(`Fallo en el lote ${chunkIndex}/${totalBatches}: ${errData.error || res.statusText}`);
        }

        const data = await res.json();
        const chunkRes = data.result || data;

        acumuladoCreated += chunkRes.createdCount || 0;
        acumuladoUpdated += chunkRes.updatedCount || 0;
        acumuladoDecoupled += chunkRes.imagesDecoupledCount || 0;
        acumuladoProcessed += chunk.length;

        setStats({
          totalItems: productos.length,
          processedItems: acumuladoProcessed,
          createdCount: acumuladoCreated,
          updatedCount: acumuladoUpdated,
          imagesDecoupledCount: acumuladoDecoupled,
          currentBatch: chunkIndex,
          totalBatches,
          durationMs: Date.now() - startTime
        });
      }

      setEstado('completado');
      setMensajeEstado(`¡Restauración exitosa! ${productos.length} productos procesados.`);

      // Guardar todos los 710 productos en el localStorage del navegador
      try {
        localStorage.setItem('bibi_store_cached_productos', JSON.stringify(productos));
      } catch (e) {
        console.warn("Aviso guardando en localStorage:", e);
      }

      if (onSuccess) {
        onSuccess({
          totalItems: productos.length,
          processedItems: acumuladoProcessed,
          createdCount: acumuladoCreated,
          updatedCount: acumuladoUpdated,
          imagesDecoupledCount: acumuladoDecoupled,
          currentBatch: totalBatches,
          totalBatches,
          durationMs: Date.now() - startTime
        });
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error durante la transmisión por chunks');
      setEstado('error');
    }
  };

  const cancelarOperacion = () => {
    cancelRef.current = true;
    setEstado('idle');
    setMensajeEstado('Operación cancelada.');
  };

  const reiniciar = () => {
    setEstado('idle');
    setArchivoSeleccionado(null);
    setErrorMsg(null);
    setMensajeEstado('');
    setStats({
      totalItems: 0,
      processedItems: 0,
      createdCount: 0,
      updatedCount: 0,
      imagesDecoupledCount: 0,
      currentBatch: 0,
      totalBatches: 0,
      durationMs: 0
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className={`bg-white border-2 sm:border-4 border-black p-3 sm:p-5 shadow-[3px_3px_0px_rgba(0,0,0,1)] sm:shadow-[4px_4px_0px_rgba(0,0,0,1)] flex flex-col gap-4 max-w-full overflow-hidden ${className}`}>
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b-2 border-black pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-yellow-400 text-black border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] shrink-0">
            <Database size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-black uppercase tracking-wider text-black flex items-center gap-1.5 flex-wrap">
              Restauración Masiva a VPS
              <span className="text-[9px] bg-black text-white px-1.5 py-0.5 uppercase tracking-widest font-mono">
                Por Lotes
              </span>
            </h3>
            <p className="text-[11px] sm:text-xs font-mono text-gray-600 mt-0.5 truncate">
              Desacople binario de Base64 a disco y persistencia SQLite WAL
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] sm:text-[11px] font-mono font-bold bg-gray-100 border border-black px-2 py-0.5 text-gray-800">
            Lote: {BATCH_SIZE} ítems
          </span>
        </div>
      </div>

      {/* Zona Drag & Drop o Selector de Archivo */}
      {estado !== 'completado' && (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          className={`border-2 border-dashed p-3.5 sm:p-5 text-center transition-all cursor-pointer ${
            isDragging 
              ? 'border-yellow-500 bg-yellow-50' 
              : archivoSeleccionado 
                ? 'border-emerald-600 bg-emerald-50/50' 
                : 'border-gray-400 hover:border-black bg-gray-50'
          }`}
          onClick={() => {
            if (estado === 'idle' || estado === 'error') {
              fileInputRef.current?.click();
            }
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />

          <div className="flex flex-col items-center justify-center gap-1.5">
            {archivoSeleccionado ? (
              <>
                <FileJson size={30} className="text-emerald-700 animate-bounce" />
                <span className="text-xs sm:text-sm font-black text-black uppercase tracking-tight break-all">
                  {archivoSeleccionado.name}
                </span>
                <span className="text-[11px] font-mono text-gray-600">
                  {(archivoSeleccionado.size / (1024 * 1024)).toFixed(2)} MB • {stats.totalItems} productos
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); reiniciar(); }}
                  className="mt-1 text-[10px] font-mono font-bold text-red-600 hover:underline uppercase flex items-center gap-1"
                >
                  <X size={12} /> Cambiar archivo
                </button>
              </>
            ) : (
              <>
                <UploadCloud size={32} className="text-gray-500" />
                <span className="text-xs sm:text-sm font-black text-black uppercase tracking-wide">
                  Arrastra aquí tu archivo JSON o haz clic para seleccionarlo
                </span>
                <span className="text-[10px] sm:text-xs font-mono text-gray-500">
                  Compatible con copias de seguridad de Bibi Store (710+ productos)
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Barra de Progreso y Estados de Carga */}
      {(estado === 'subiendo' || estado === 'procesando' || estado === 'completado') && (
        <div className="space-y-3 bg-gray-50 border-2 border-black p-4">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="font-black uppercase text-black flex items-center gap-2">
              {estado === 'completado' ? (
                <span className="text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 size={16} /> Completado
                </span>
              ) : (
                <span className="text-black flex items-center gap-2">
                  <RefreshCw size={14} className="animate-spin text-emerald-600" />
                  {mensajeEstado}
                </span>
              )}
            </span>
            <span className="font-bold text-sm text-black">{porcentaje}%</span>
          </div>

          {/* Barra Visual */}
          <div className="w-full bg-gray-200 border-2 border-black h-5 overflow-hidden relative">
            <div
              className={`h-full transition-all duration-300 ${
                estado === 'completado' ? 'bg-emerald-500' : 'bg-yellow-400'
              }`}
              style={{ width: `${porcentaje}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-black text-black">
              Lote {stats.currentBatch} de {stats.totalBatches} ({stats.processedItems} / {stats.totalItems} productos)
            </div>
          </div>

          {/* Métricas en Tiempo Real */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-center">
            <div className="bg-white border border-black p-2">
              <span className="text-[10px] font-mono uppercase text-gray-500 block">Nuevos</span>
              <span className="text-sm font-black text-emerald-700">+{stats.createdCount}</span>
            </div>
            <div className="bg-white border border-black p-2">
              <span className="text-[10px] font-mono uppercase text-gray-500 block">Actualizados</span>
              <span className="text-sm font-black text-blue-700">+{stats.updatedCount}</span>
            </div>
            <div className="bg-white border border-black p-2">
              <span className="text-[10px] font-mono uppercase text-gray-500 block flex items-center justify-center gap-1">
                <ImageIcon size={10} /> Fotos Desacopladas
              </span>
              <span className="text-sm font-black text-amber-700">{stats.imagesDecoupledCount}</span>
            </div>
            <div className="bg-white border border-black p-2">
              <span className="text-[10px] font-mono uppercase text-gray-500 block">Tiempo</span>
              <span className="text-sm font-mono font-bold text-gray-900">
                {(stats.durationMs / 1000).toFixed(1)}s
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Manejo Explícito de Errores */}
      {estado === 'error' && errorMsg && (
        <div className="bg-red-50 border-2 border-red-600 p-4 text-red-900 flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <h4 className="text-xs font-black uppercase tracking-wider">Error en la Restauración</h4>
            <p className="text-xs font-mono break-all">{errorMsg}</p>
            <div className="pt-2">
              <button
                type="button"
                onClick={iniciarRestauracion}
                className="bg-red-600 hover:bg-black text-white text-xs font-bold px-3 py-1.5 uppercase font-mono tracking-wider border border-black transition-colors inline-flex items-center gap-1"
              >
                <RefreshCw size={12} /> Reintentar Lote
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Acciones del Pie */}
      <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
        {(estado === 'subiendo' || estado === 'procesando') && (
          <button
            type="button"
            onClick={cancelarOperacion}
            className="w-full sm:w-auto px-5 py-3 border-2 border-black bg-white hover:bg-red-50 text-red-700 text-xs font-black uppercase font-mono tracking-wider transition-colors"
          >
            Cancelar
          </button>
        )}

        {estado === 'idle' && archivoSeleccionado && (
          <button
            type="button"
            onClick={iniciarRestauracion}
            className="w-full sm:w-auto px-8 py-3.5 bg-black hover:bg-yellow-400 hover:text-black text-white text-xs font-black uppercase tracking-widest border-2 border-black shadow-[3px_3px_0px_rgba(0,0,0,1)] transition-all flex items-center justify-center gap-2"
          >
            <HardDrive size={16} />
            <span>Iniciar Restauración Atómica ({stats.totalItems} productos)</span>
          </button>
        )}

        {estado === 'completado' && (
          <button
            type="button"
            onClick={reiniciar}
            className="w-full sm:w-auto px-6 py-3 bg-black text-white hover:bg-yellow-400 hover:text-black text-xs font-black uppercase tracking-widest border-2 border-black transition-all flex items-center justify-center gap-2"
          >
            <Check size={16} />
            <span>Cargar Otro Respaldo</span>
          </button>
        )}
      </div>
    </div>
  );
}
