import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * ==============================================================================
 * PIPELINE DE DESACOPLE Y ALMACENAMIENTO DE IMÁGENES EN DISCO (VPS)
 * ==============================================================================
 * Problema resuelto:
 *   Las cadenas Base64 inflan un 33% el tamaño de la imagen, provocando JSONs
 *   de 200MB+, agotamiento de memoria en V8 (JavaScript heap out of memory)
 *   y bloqueos de I/O en Node.js.
 *
 * Solución:
 *   1. Detección no bloqueante de Base64 (data:image/...;base64,...).
 *   2. Extracción a Buffer binario nativo de Node.js.
 *   3. Hasheo determinista (SHA-256 parcial) para deduplicación física de archivos.
 *   4. Escritura asíncrona a disco (fs.promises.writeFile) en la carpeta servida por Nginx.
 *   5. Retorno de la URL estática relativa (/uploads/productos/<filename>) para
 *      persistir únicamente un string liviano (~40 bytes) en la base de datos.
 */

// Directorio físico donde Nginx sirve los archivos estáticos
const DEFAULT_UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), 'public', 'uploads', 'productos');
const PUBLIC_URL_PREFIX = '/uploads/productos';

// Tipos MIME soportados y sus extensiones limpias
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg'
};

export interface ImageProcessingResult {
  imagenUrl: string;
  isDecoupled: boolean;
  sizeBytes?: number;
  error?: string;
}

/**
 * Valida si un string contiene un prefijo Data URL Base64 de imagen
 */
export function isBase64Image(str?: string | null): boolean {
  if (!str || typeof str !== 'string') return false;
  return str.startsWith('data:image/') && str.includes(';base64,');
}

/**
 * Pipeline principal de desacople de imagen por producto.
 * 
 * @param rawImage - La cadena que puede ser base64, una URL existente, o null/undefined.
 * @param productoId - ID o identificador del producto para trazabilidad.
 * @param uploadsDir - Directorio opcional de destino en el disco de la VPS.
 * @returns Promesa con la URL estática relativa y metadatos de procesamiento.
 */
export async function processAndDecoupleImage(
  rawImage?: string | null,
  productoId: string = 'prod',
  uploadsDir: string = DEFAULT_UPLOADS_DIR
): Promise<ImageProcessingResult> {
  // 1. Si no tiene imagen o ya es una URL relativa/absoluta, mantenerla
  if (!rawImage || typeof rawImage !== 'string' || !isBase64Image(rawImage)) {
    return {
      imagenUrl: rawImage || '',
      isDecoupled: false
    };
  }

  try {
    // 2. Extraer metadatos MIME y payload Base64 puro
    const matches = rawImage.match(/^data:([a-zA-Z0-9\/+.-]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return {
        imagenUrl: rawImage,
        isDecoupled: false,
        error: 'Formato Data URL inválido'
      };
    }

    const mimeType = matches[1].toLowerCase();
    const base64Data = matches[2];
    const extension = MIME_TO_EXT[mimeType] || 'jpg';

    // 3. Conversión no bloqueante a Buffer binario nativo
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const sizeBytes = imageBuffer.length;

    // Validación básica: evitar archivos vacíos o corruptos
    if (sizeBytes === 0) {
      return {
        imagenUrl: '',
        isDecoupled: false,
        error: 'El buffer de imagen decodificado tiene 0 bytes'
      };
    }

    // 4. Hash SHA-256 corto del contenido para deduplicación
    const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex').substring(0, 10);
    const sanitizedId = productoId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
    const fileName = `${sanitizedId}_${hash}.${extension}`;
    const targetFilePath = path.join(uploadsDir, fileName);

    // 5. Asegurar creación del directorio destino de forma asíncrona
    await fs.promises.mkdir(uploadsDir, { recursive: true });

    // 6. Escritura atómica / asíncrona al disco de la VPS (NUNCA fs.writeFileSync)
    // Solo escribimos si el archivo no existe para evitar sobreescritura redundante
    try {
      await fs.promises.access(targetFilePath);
    } catch {
      await fs.promises.writeFile(targetFilePath, imageBuffer);
    }

    // 7. Retornar URL relativa optimizada para Nginx
    const staticUrl = `${PUBLIC_URL_PREFIX}/${fileName}`;

    return {
      imagenUrl: staticUrl,
      isDecoupled: true,
      sizeBytes
    };
  } catch (err: any) {
    console.error(`[ImagePipeline] Error desacoplando imagen del producto ${productoId}:`, err);
    // En caso de fallo en el desacople, no bloqueamos la inserción del producto
    return {
      imagenUrl: '',
      isDecoupled: false,
      error: err.message || 'Error procesando buffer de imagen'
    };
  }
}
