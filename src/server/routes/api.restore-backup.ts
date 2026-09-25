import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { processProductsBatch, type RawBackupProducto, type BatchRestoreResult } from '../services/restoreService.server';

/**
 * ==============================================================================
 * REMIX ACTION: /api/restore-backup
 * ==============================================================================
 * Solución técnica a los 3 fallos críticos:
 *  1. Gestión de Payload: Soporta modo chunking por lotes (50-100 ítems) para
 *     evitar peticiones monolíticas de 200MB que rechaza Nginx/Express (413).
 *  2. Desacople Asíncrono de Imágenes: Las imágenes Base64 se extraen a disco
 *     físico de la VPS en paralelo asíncrono y se guardan como URLs relativas.
 *  3. Inserción Transaccional por Chunks: El procesamiento por lotes dentro de
 *     transacciones SQLite WAL previene el desbordamiento de memoria RAM de Node.js.
 */

// Tamaño de lote recomendado para no saturar memoria RAM en droplets de 1GB
const CHUNK_SIZE = 75;

export async function action({ request }: ActionFunctionArgs) {
  // Manejo de Preflight CORS si se invoca desde clientes cruzados
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
      }
    });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Método no permitido. Solo se acepta POST.' }, { status: 405 });
  }

  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return json(
        { error: 'Content-Type inválido. Se espera application/json.' },
        { status: 400 }
      );
    }

    // Parseo no bloqueante del payload
    const body = await request.json();

    const tasaReferencial = Number(body.config?.tasa_dolar) || Number(body.tasa_dolar) || 50;

    // --------------------------------------------------------------------------
    // CASO 1: MODO CHUNKING (El frontend envía lotes de 50-100 ítems)
    // --------------------------------------------------------------------------
    if (body.mode === 'chunk' || Array.isArray(body.items)) {
      const items: RawBackupProducto[] = body.items || [];
      const batchIndex = Number(body.batchIndex) || 0;
      const totalBatches = Number(body.totalBatches) || 1;

      if (!Array.isArray(items) || items.length === 0) {
        return json({ error: 'El lote no contiene elementos válidos.' }, { status: 400 });
      }

      // Procesar el lote de forma atómica en SQLite WAL
      const result: BatchRestoreResult = await processProductsBatch(items, {
        tasaDolarReferencial: tasaReferencial
      });

      return json({
        success: true,
        mode: 'chunk',
        batchIndex,
        totalBatches,
        result
      }, {
        headers: {
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // --------------------------------------------------------------------------
    // CASO 2: MODO MONOLÍTICO COMPLETO (Se divide en chunks en el servidor)
    // --------------------------------------------------------------------------
    let allProducts: RawBackupProducto[] = [];
    if (Array.isArray(body)) {
      allProducts = body;
    } else if (Array.isArray(body.productos)) {
      allProducts = body.productos;
    } else {
      return json({
        error: 'Formato de respaldo desconocido. Se esperaba una lista de productos.'
      }, { status: 400 });
    }

    if (allProducts.length === 0) {
      return json({ error: 'El archivo de respaldo no contiene productos.' }, { status: 400 });
    }

    // Partición en chunks controlados para evitar picos de Garbage Collector
    const totalItems = allProducts.length;
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalImagesDecoupled = 0;
    const allErrors: any[] = [];
    const startTime = Date.now();

    for (let offset = 0; offset < totalItems; offset += CHUNK_SIZE) {
      const chunk = allProducts.slice(offset, offset + CHUNK_SIZE);
      const chunkResult = await processProductsBatch(chunk, {
        tasaDolarReferencial: tasaReferencial
      });

      totalCreated += chunkResult.createdCount;
      totalUpdated += chunkResult.updatedCount;
      totalImagesDecoupled += chunkResult.imagesDecoupledCount;
      if (chunkResult.errors.length > 0) {
        allErrors.push(...chunkResult.errors);
      }

      // Pequeña pausa de microtareas para permitir que el Event Loop atienda I/O y libere memoria
      await new Promise(resolve => setImmediate(resolve));
    }

    return json({
      success: true,
      mode: 'full',
      totalReceived: totalItems,
      createdCount: totalCreated,
      updatedCount: totalUpdated,
      imagesDecoupledCount: totalImagesDecoupled,
      errorsCount: allErrors.length,
      errors: allErrors.slice(0, 20), // Primeros 20 errores representativos
      durationMs: Date.now() - startTime
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error: any) {
    console.error('[Action: restore-backup] Error crítico:', error);
    return json({
      success: false,
      error: error.message || 'Error interno procesando la restauración'
    }, {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
