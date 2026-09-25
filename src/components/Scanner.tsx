import React, { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner, Html5Qrcode } from 'html5-qrcode';
import { X, Camera, Scan, Sparkles, Loader2 } from 'lucide-react';
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
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerId = "reader";

  useEffect(() => {
    if (mode === 'barcode') {
      const html5QrCode = new Html5Qrcode(containerId);
      scannerRef.current = html5QrCode;

      const config = { fps: 10, qrbox: { width: 250, height: 150 } };

      html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          onScan(decodedText);
          onClose();
        },
        () => {} // silence errors during scan
      ).catch(err => {
        console.error(err);
        setError("Error al iniciar camara. Asegúrate de dar permisos.");
      });

      return () => {
        if (html5QrCode.isScanning) {
          html5QrCode.stop().catch(console.error);
        }
      };
    } else {
      // Smart Mode / OCR setup
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then(stream => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            setIsScanning(true);
          }
        })
        .catch(err => {
          console.error(err);
          setError("No se pudo acceder a la cámara para el escaneo inteligente.");
        });

      return () => {
        if (videoRef.current && videoRef.current.srcObject) {
          const stream = videoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach(track => track.stop());
        }
      };
    }
  }, [mode]);

  const captureSmartScan = async () => {
    if (!videoRef.current || loadingSmart) return;
    
    setLoadingSmart(true);
    setError(null);

    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not get context");
      
      ctx.drawImage(videoRef.current, 0, 0);
      const base64Image = canvas.toDataURL('image/jpeg').split(',')[1];

      // Use Gemini to read barcode OR numbers
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

      const imagePart = {
        inlineData: {
          data: base64Image,
          mimeType: "image/jpeg"
        }
      };
      
      const prompt = "Identify the product barcode number or the reference code number written on the product in this image. Only output the number itself, nothing else. If there are multiple numbers, find the one that looks like a serial or product code. If no number is found, reply with 'NOT_FOUND'.";
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts: [imagePart, { text: prompt }] },
      });

      const text = response.text?.trim() || 'NOT_FOUND';
      if (text === 'NOT_FOUND') {
        setError("No se detectó ningún código. Intenta de nuevo.");
      } else {
        // Cleaning potentially non-numeric stuff if it's just a code
        const cleaned = text.replace(/[^a-zA-Z0-9]/g, '');
        onScan(cleaned);
        onClose();
      }
    } catch (err) {
      console.error(err);
      setError("Error en escaneo inteligente.");
    } finally {
      setLoadingSmart(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 flex flex-col z-[100] animate-in fade-in duration-200">
      <div className="p-4 flex justify-between items-center bg-black border-b border-white/20">
        <h2 className="text-white font-black uppercase tracking-widest text-sm">{title}</h2>
        <button onClick={onClose} className="text-white p-2 hover:bg-white/10 rounded-full transition-colors">
          <X size={24} />
        </button>
      </div>

      <div className="flex-1 relative flex flex-col items-center justify-center overflow-hidden">
        {mode === 'barcode' ? (
          <div id={containerId} className="w-full h-full max-w-lg bg-black" />
        ) : (
          <div className="w-full h-full relative flex items-center justify-center">
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute inset-0 border-[60px] border-black/50 pointer-events-none">
              <div className="w-full h-full border-2 border-yellow-400 border-dashed animate-pulse relative">
                <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-yellow-400 shadow-[0_0_15px_rgba(250,204,21,1)]" />
              </div>
            </div>
            
            <div className="absolute bottom-10 left-0 right-0 flex justify-center px-4">
              <button 
                onClick={captureSmartScan}
                disabled={loadingSmart}
                className="bg-yellow-400 text-black px-8 py-4 font-black uppercase tracking-widest flex items-center gap-3 shadow-[8px_8px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all disabled:opacity-50"
              >
                {loadingSmart ? <Loader2 className="animate-spin" /> : <Camera size={24} />}
                Capturar y Leer
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-red-600 text-white px-4 py-2 border-2 border-white text-[10px] font-black uppercase tracking-widest shadow-xl">
            {error}
          </div>
        )}
      </div>

      <div className="bg-black p-6 border-t border-white/20 flex justify-center gap-4">
        <button 
          onClick={() => setMode('barcode')}
          className={`flex-1 flex flex-col items-center gap-2 py-4 border-2 transition-all ${mode === 'barcode' ? 'bg-white text-black border-white' : 'bg-transparent text-white border-white/30 hover:border-white'}`}
        >
          <Scan size={24} />
          <span className="text-[10px] font-black uppercase tracking-widest">Código de Barras</span>
        </button>
        <button 
          onClick={() => setMode('smart')}
          className={`flex-1 flex flex-col items-center gap-2 py-4 border-2 transition-all ${mode === 'smart' ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-transparent text-white border-white/30 hover:border-white'}`}
        >
          <Sparkles size={24} />
          <span className="text-[10px] font-black uppercase tracking-widest">IA Inteligente</span>
        </button>
      </div>
      
      <div className="bg-black pb-8 px-6 text-center">
        <p className="text-[9px] text-gray-500 font-mono uppercase tracking-widest">
          {mode === 'barcode' ? "Apunta al código de barras tradicional." : "Usa IA para leer números de referencia o precios manuales."}
        </p>
      </div>
    </div>
  );
}
