import pg from "pg";

export type DbPool = pg.Pool;

export function createDbPool(connectionString: string): DbPool {
  return new pg.Pool({ connectionString });
}

