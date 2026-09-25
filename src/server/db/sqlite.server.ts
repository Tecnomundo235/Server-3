import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SQLITE_INIT_DDL } from './schema';

/**
 * ==============================================================================
 * CONEXIÓN Y CONFIGURACIÓN OPTIMIZADA DE SQLITE (WAL MODE) PARA VPS
 * ==============================================================================
 * Características críticas para producción en VPS DigitalOcean (1GB RAM):
 *  - WAL (Write-Ahead Logging): Permite lecturas y escrituras simultáneas sin bloqueos.
 *  - cache_size = -64000: Limita el consumo de memoria a 64MB para no disparar el OOM killer.
 *  - synchronous = NORMAL: Reduce operaciones fsync a disco preservando integridad.
 *  - busy_timeout = 5000: Evita excepciones 'database is locked' en concurrencia.
 */

const DB_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_PATH = process.env.DATABASE_URL || path.join(DB_DIR, 'bibi_pos.db');

let dbInstance: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (dbInstance) return dbInstance;

  // Asegurar existencia del directorio de datos
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  dbInstance = new Database(DB_PATH, {
    // verbose: process.env.NODE_ENV === 'development' ? console.log : undefined,
    timeout: 5000
  });

  // Aplicar pragmas de alto rendimiento y estabilidad
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('synchronous = NORMAL');
  dbInstance.pragma('foreign_keys = ON');
  dbInstance.pragma('cache_size = -64000'); // 64 MB
  dbInstance.pragma('temp_store = MEMORY');
  dbInstance.pragma('busy_timeout = 5000');

  // Inicializar esquema si no existe
  dbInstance.exec(SQLITE_INIT_DDL);

  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } finally {
      dbInstance = null;
    }
  }
}
