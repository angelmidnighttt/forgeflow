import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';
import { tenantContextStatement, type TenantContext } from './tenant.js';

export {
  databaseEnvSchema,
  loadMigrationEnv,
  migrationEnvSchema,
  type DatabaseEnv,
  type MigrationEnv,
} from './env.js';
export { migrateDatabase, migrationsFolder } from './migrate.js';
export * from './schema/index.js';
export { roleBypassesRowLevelSecurity, type TenantContext } from './tenant.js';

export type Database = NodePgDatabase<typeof schema>;
/** The `tx` handed to `db.transaction(async (tx) => …)`. */
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Either the pool-backed database or an open transaction: lets a query join the caller's transaction. */
export type DbExecutor = Database | DatabaseTransaction;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  /**
   * Runs `work` in a transaction whose row-level security context is `context`. Every query on
   * a tenant table (organizations, memberships, invitations…) must run inside one: without a
   * context the policies match no rows.
   */
  withTenant<T>(context: TenantContext, work: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
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
  return {
    db,
    pool,
    withTenant: (context, work) =>
      db.transaction(async (tx) => {
        await tx.execute(tenantContextStatement(context));
        return work(tx);
      }),
    close: () => pool.end(),
  };
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
