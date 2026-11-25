import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export { databaseEnvSchema, loadDatabaseEnv, type DatabaseEnv } from './env.js';
export { migrateDatabase, migrationsFolder } from './migrate.js';
export * from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

export interface CreateDatabaseOptions {
  /** Maximum connections in the pool. */
  max?: number;
  /** Shown in pg_stat_activity, which helps when debugging connections. */
  applicationName?: string;
  /**
   * Called when an idle pooled connection breaks (database restart, failover, network drop).
   * The pool discards that connection and opens a new one on the next query.
   */
  onIdleClientError?: (error: Error) => void;
}

export function createDatabase(url: string, options: CreateDatabaseOptions = {}): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'forgeflow',
    connectionTimeoutMillis: 5_000,
  });
  // Without a listener, an 'error' from an idle connection is an unhandled event that crashes
  // the whole process the moment PostgreSQL restarts.
  pool.on(
    'error',
    options.onIdleClientError ??
      ((error) => console.warn(`[database] idle connection error: ${error.message}`)),
  );
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  return { db, pool, close: () => pool.end() };
}

/** Returns true when the database answers `SELECT 1` within `timeoutMs`. Never throws. */
export async function pingDatabase(pool: pg.Pool, timeoutMs = 2_000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const ping = pool.query('SELECT 1').then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([ping, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
