import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, Scan, Sparkles, Loader2, Upload, AlertTriangle, HelpCircle, Check, Keyboard } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

interface ScannerProps {
  onScan: (text: string) => void;
  onClose: () => void;
  title?: string;
}

export default function Scanner({ onScan, onClose, title = "Escanear Código" }: ScannerProps) {
  const [mode, setMode] = useState<'barcode' | 'smart'>('barcode');
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingSmart, setLoadingSmart] = useState(false);
  const [processingFile, setProcessingFile] = useState(false);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [showChromeHelp, setShowChromeHelp] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualCode, setManualCode] = useState('');

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputCameraRef = useRef<HTMLInputElement>(null);
  const fileInputGalleryRef = useRef<HTMLInputElement>(null);
  const containerId = "reader";

  const isInsecureHttp = typeof window !== 'undefined' && 
    window.location.protocol === 'http:' && 
    window.location.hostname !== 'localhost' && 
    window.location.hostname !== '127.0.0.1';

  // Iniciar lector de código de barras
  useEffect(() => {
    setError(null);

    if (mode === 'barcode') {
      let html5QrCode: Html5Qrcode;
      try {
        html5QrCode = new Html5Qrcode(containerId);
        scannerRef.current = html5QrCode;
      } catch (e) {
        console.warn("No se pudo instanciar Html5Qrcode:", e);
        setCameraBlocked(true);
        return;
      }

      const config = { fps: 10, qrbox: { width: 250, height: 150 } };

      html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          onScan(decodedText);
          onClose();
        },
        () => {} // silence errors during scan
      ).then(() => {
        setIsScanning(true);
        setCameraBlocked(false);
      }).catch(err => {
        console.warn("Cámara en vivo no disponible:", err);
        setCameraBlocked(true);
        if (isInsecureHttp) {
          setError("Chrome bloquea la cámara continua en HTTP. Usa el botón 'Tomar Foto' a continuación.");
        } else {
          setError("No se pudo iniciar la cámara en vivo. Usa el botón 'Tomar Foto'.");
        }
      });

      return () => {
        if (html5QrCode.isScanning) {
          html5QrCode.stop().catch(() => {});
        }
      };
    } else {
      // Modo Inteligente (video continuo o captura)
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
          .then(stream => {
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
              setIsScanning(true);
              setCameraBlocked(false);
            }
          })
          .catch(err => {
            console.warn("Error accediendo a video stream:", err);
            setCameraBlocked(true);
            setError("Cámara en vivo no permitida en HTTP. Toma una foto para leer con IA.");
          });
      } else {
        setCameraBlocked(true);
        setError("Cámara en vivo no permitida en HTTP. Toma una foto para leer con IA.");
      }

      return () => {
        if (videoRef.current && videoRef.current.srcObject) {
          const stream = videoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach(track => track.stop());
        }
      };
    }
  }, [mode]);

  // Procesar archivo de imagen (Tomada con cámara nativa o desde galería)
  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProcessingFile(true);
    setError(null);

    try {
      if (mode === 'barcode') {
        // Usar Html5Qrcode.scanFile
        let qrScanner = scannerRef.current;
        if (!qrScanner) {
          qrScanner = new Html5Qrcode(containerId);
          scannerRef.current = qrScanner;
        }

        try {
          const decodedText = await qrScanner.scanFile(file, false);
          if (decodedText) {
            onScan(decodedText);
            onClose();
            return;
          }
        } catch (scanErr) {
          console.warn("scanFile tradicional no encontró código, intentando fallback con IA:", scanErr);
        }

        // Si falló el scanner tradicional, intentar con Gemini si hay API key
        await processWithGemini(file);
      } else {
        // Modo inteligente con Gemini
        await processWithGemini(file);
      }
    } catch (err: any) {
      console.error(err);
      setError("No se detectó el código en la foto. Intenta tomarla más de cerca y con buena luz, o ingresa el código a mano.");
    } finally {
      setProcessingFile(false);
      if (e.target) e.target.value = '';
    }
  };

  const processWithGemini = async (file: File) => {
    const apiKey = process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("No se detectó código en la imagen.");
    }

    const reader = new FileReader();
    const base64Promise = new Promise<string>((resolve, reject) => {
      reader.onload = () => {
        const res = reader.result as string;
        resolve(res.split(',')[1]);
      };
      reader.onerror = reject;
    });
    reader.readAsDataURL(file);
    const base64Data = await base64Promise;

    const ai = new GoogleGenAI({ apiKey });
    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: file.type || "image/jpeg"
      }
    };

    const prompt = "Identify the product barcode number or reference code written on the product in this image. Only output the numeric or alphanumeric code itself, nothing else. If there are multiple numbers, find the one that is the product barcode or SKU. If no barcode or code is found, reply with 'NOT_FOUND'.";

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts: [imagePart, { text: prompt }] },
    });

    const text = response.text?.trim() || 'NOT_FOUND';
    if (text === 'NOT_FOUND' || text.length < 3) {
      throw new Error("No se detectó ningún código en la foto.");
    }

    const cleaned = text.replace(/[^a-zA-Z0-9_-]/g, '');
    onScan(cleaned);
    onClose();
  };

  // Captura desde video en vivo en modo Smart
  const captureSmartScan = async () => {
    if (!videoRef.current || loadingSmart) return;
    
    setLoadingSmart(true);
    setError(null);

    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not get context");
      
      ctx.drawImage(videoRef.current, 0, 0);
      const base64Image = canvas.toDataURL('image/jpeg').split(',')[1];

      const apiKey = process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("API key no disponible.");
      }

      const ai = new GoogleGenAI({ apiKey });
      const imagePart = {
        inlineData: {
          data: base64Image,
          mimeType: "image/jpeg"
        }
      };
      
      const prompt = "Identify the product barcode number or the reference code number written on the product in this image. Only output the number itself, nothing else. If there are multiple numbers, find the one that looks like a serial or product code. If no number is found, reply with 'NOT_FOUND'.";
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: { parts: [imagePart, { text: prompt }] },
      });

      const text = response.text?.trim() || 'NOT_FOUND';
      if (text === 'NOT_FOUND') {
        setError("No se detectó ningún código. Intenta de nuevo o tómale una foto de cerca.");
      } else {
        const cleaned = text.replace(/[^a-zA-Z0-9]/g, '');
        onScan(cleaned);
        onClose();
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Error en escaneo inteligente.");
    } finally {
      setLoadingSmart(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = manualCode.trim();
    if (clean) {
      onScan(clean);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/95 flex flex-col z-[100] animate-in fade-in duration-200">
      {/* Inputs invisibles para captura de cámara nativa y galería */}
      <input 
        type="file" 
        ref={fileInputCameraRef} 
        accept="image/*" 
        capture="environment" 
        className="hidden" 
        onChange={handleImageFile} 
      />
      <input 
        type="file" 
        ref={fileInputGalleryRef} 
        accept="image/*" 
        className="hidden" 
        onChange={handleImageFile} 
      />

      {/* Header */}
      <div className="p-4 flex justify-between items-center bg-black border-b border-white/20">
        <div className="flex items-center gap-2">
          <Scan className="text-yellow-400" size={20} />
          <h2 className="text-white font-black uppercase tracking-widest text-sm">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowChromeHelp(!showChromeHelp)}
            className="text-gray-400 hover:text-white p-2 rounded-full transition-colors flex items-center gap-1 text-xs"
            title="Ayuda de cámara"
          >
            <HelpCircle size={18} />
          </button>
          <button onClick={onClose} className="text-white p-2 hover:bg-white/10 rounded-full transition-colors">
            <X size={24} />
          </button>
        </div>
      </div>

      {/* Alerta de Ayuda para Chrome / HTTP */}
      {showChromeHelp && (
        <div className="bg-yellow-400 text-black p-4 text-xs font-mono border-b-2 border-black flex flex-col gap-2 animate-in slide-in-from-top duration-150">
          <div className="flex justify-between items-start font-black text-sm uppercase">
            <span>¿Por qué Chrome bloquea el video en vivo en HTTP?</span>
            <button onClick={() => setShowChromeHelp(false)}><X size={16} /></button>
          </div>
          <p>
            Por seguridad mundial, los navegadores (Chrome, Safari) exigen <b>HTTPS</b> para transmitir video continuo.
          </p>
          <div className="bg-black/10 p-2 rounded">
            <p className="font-bold mb-1">✅ 2 Soluciones Inmediatas:</p>
            <ol className="list-decimal ml-4 space-y-1">
              <li>
                <b>Usa el botón amarillo "Tomar Foto con Cámara":</b> Abre la cámara nativa de tu celular directamente y lee el código al instante (¡funciona 100% en HTTP!).
              </li>
              <li>
                <b>Activar video en vivo en Chrome (1 minuto):</b>
                <br />Escribe en la barra de Chrome de tu teléfono: 
                <code className="bg-black text-white px-1.5 py-0.5 rounded font-bold ml-1">chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>
                <br />Coloca tu IP: <code className="bg-black text-white px-1.5 py-0.5 rounded font-bold">http://143.198.163.70</code>, cámbialo a <b>Enabled</b> y pulsa <b>Relaunch</b>.
              </li>
            </ol>
          </div>
        </div>
      )}

      {/* Cuerpo principal del escáner */}
      <div className="flex-1 relative flex flex-col items-center justify-center overflow-hidden p-4">
        {/* Contenedor Html5Qrcode */}
        <div 
          id={containerId} 
          className={`w-full max-w-md ${cameraBlocked || mode !== 'barcode' ? 'hidden' : 'block'} bg-black`} 
        />

        {/* Video en vivo para modo Smart */}
        {mode === 'smart' && !cameraBlocked && (
          <div className="w-full h-full relative flex items-center justify-center max-w-md">
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute inset-0 border-[40px] border-black/50 pointer-events-none">
              <div className="w-full h-full border-2 border-yellow-400 border-dashed animate-pulse relative">
                <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-yellow-400 shadow-[0_0_15px_rgba(250,204,21,1)]" />
              </div>
            </div>
            
            <div className="absolute bottom-6 left-0 right-0 flex justify-center px-4">
              <button 
                onClick={captureSmartScan}
                disabled={loadingSmart}
                className="bg-yellow-400 text-black px-6 py-3 font-black uppercase tracking-widest flex items-center gap-2 shadow-[6px_6px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 transition-all disabled:opacity-50 text-xs"
              >
                {loadingSmart ? <Loader2 className="animate-spin" size={18} /> : <Camera size={18} />}
                Capturar y Leer con IA
              </button>
            </div>
          </div>
        )}

        {/* Panel de Fallback Activo (Cuando la cámara en vivo no está disponible o da error en HTTP) */}
        {(cameraBlocked || isInsecureHttp || !isScanning) && (
          <div className="w-full max-w-sm flex flex-col items-center text-center p-6 bg-zinc-900 border-2 border-white/20 shadow-2xl my-auto">
            <div className="w-16 h-16 bg-yellow-400/10 border-2 border-yellow-400 rounded-full flex items-center justify-center mb-4 text-yellow-400">
              <Camera size={32} />
            </div>

            <h3 className="text-white font-black uppercase text-base tracking-wider mb-2">
              Escanear con Cámara
            </h3>

            <p className="text-gray-300 text-xs font-mono mb-6 leading-relaxed">
              Toma una foto clara del código de barras con la cámara de tu celular para agregarlo al instante.
            </p>

            {/* Botón principal: Tomar foto con la cámara del celular */}
            <button
              onClick={() => fileInputCameraRef.current?.click()}
              disabled={processingFile}
              className="w-full bg-yellow-400 hover:bg-yellow-300 text-black font-black uppercase tracking-widest py-4 px-6 border-2 border-black flex items-center justify-center gap-3 shadow-[6px_6px_0px_rgba(255,255,255,0.3)] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all disabled:opacity-50 text-sm mb-3"
            >
              {processingFile ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  <span>Leyendo Foto...</span>
                </>
              ) : (
                <>
                  <Camera size={22} />
                  <span>Tomar Foto del Código</span>
                </>
              )}
            </button>

            {/* Botón secundario: Subir imagen de galería */}
            <div className="flex gap-2 w-full mb-4">
              <button
                onClick={() => fileInputGalleryRef.current?.click()}
                disabled={processingFile}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white font-bold uppercase tracking-wider py-2.5 px-3 border border-white/20 flex items-center justify-center gap-2 text-[11px] transition-all"
              >
                <Upload size={16} />
                <span>De Galería</span>
              </button>

              <button
                onClick={() => setShowManualInput(!showManualInput)}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-yellow-400 font-bold uppercase tracking-wider py-2.5 px-3 border border-white/20 flex items-center justify-center gap-2 text-[11px] transition-all"
              >
                <Keyboard size={16} />
                <span>Escribir Código</span>
              </button>
            </div>

            {/* Input manual desplegable */}
            {showManualInput && (
              <form onSubmit={handleManualSubmit} className="w-full flex gap-2 pt-2 border-t border-white/10 animate-in fade-in">
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="Ej: 7590106007662"
                  autoFocus
                  className="flex-1 bg-black border border-white/30 text-white px-3 py-2 text-xs font-mono focus:border-yellow-400 outline-none"
                />
                <button
                  type="submit"
                  disabled={!manualCode.trim()}
                  className="bg-yellow-400 text-black px-4 py-2 font-black text-xs uppercase disabled:opacity-50 flex items-center gap-1"
                >
                  <Check size={16} />
                  <span>OK</span>
                </button>
              </form>
            )}

            {isInsecureHttp && (
              <div className="mt-4 flex items-center justify-center gap-1.5 text-zinc-400 text-[10px] font-mono">
                <AlertTriangle size={14} className="text-yellow-400 shrink-0" />
                <span>Navegando por HTTP (143.198.163.70)</span>
                <button 
                  onClick={() => setShowChromeHelp(true)}
                  className="underline text-yellow-400 ml-1 font-bold"
                >
                  ¿Cómo activar video en vivo?
                </button>
              </div>
            )}
          </div>
        )}

        {/* Notificación de Error */}
        {error && (
          <div className="absolute top-4 left-4 right-4 bg-red-600 text-white p-3 border-2 border-white text-xs font-black uppercase tracking-wider shadow-2xl flex items-start justify-between gap-2 z-20">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-white hover:text-gray-200">
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Tabs inferiores: Código de barras vs IA */}
      <div className="bg-black p-4 border-t border-white/20 flex justify-center gap-4">
        <button 
          onClick={() => { setMode('barcode'); setError(null); }}
          className={`flex-1 flex flex-col items-center gap-1.5 py-3 border-2 transition-all ${mode === 'barcode' ? 'bg-white text-black border-white' : 'bg-transparent text-white border-white/30 hover:border-white'}`}
        >
          <Scan size={20} />
          <span className="text-[10px] font-black uppercase tracking-widest">Código de Barras</span>
        </button>
        <button 
          onClick={() => { setMode('smart'); setError(null); }}
          className={`flex-1 flex flex-col items-center gap-1.5 py-3 border-2 transition-all ${mode === 'smart' ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-transparent text-white border-white/30 hover:border-white'}`}
        >
          <Sparkles size={20} />
          <span className="text-[10px] font-black uppercase tracking-widest">IA Inteligente</span>
        </button>
      </div>
      
      <div className="bg-black pb-4 px-6 text-center">
        <p className="text-[9px] text-gray-500 font-mono uppercase tracking-widest">
          {mode === 'barcode' ? "Escaneo directo de códigos UPC / EAN-13" : "Usa IA para leer códigos borrosos o números manuales"}
        </p>
      </div>
    </div>
  );
}

