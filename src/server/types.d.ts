// Type declarations for Remix / Server-side execution

declare module '@remix-run/node' {
  export interface ActionFunctionArgs {
    request: Request;
    params: Record<string, string | undefined>;
    context?: any;
  }
  export function json<T = any>(data: T, init?: number | ResponseInit): Response;
}

declare module 'better-sqlite3' {
  namespace Database {
    interface Database {
      pragma(pragmaStr: string): any;
      exec(sql: string): this;
      prepare(sql: string): Statement;
      transaction<T extends (...args: any[]) => any>(fn: T): T;
      close(): this;
    }
    interface Statement {
      run(...bindParameters: any[]): RunResult;
      get(...bindParameters: any[]): any;
      all(...bindParameters: any[]): any[];
    }
    interface RunResult {
      changes: number;
      lastInsertRowid: number | bigint;
    }
  }

  interface DatabaseConstructor {
    new (filename: string, options?: { timeout?: number; verbose?: (...args: any[]) => void }): Database.Database;
    (filename: string, options?: { timeout?: number; verbose?: (...args: any[]) => void }): Database.Database;
  }

  const Database: DatabaseConstructor;
  export = Database;
}
