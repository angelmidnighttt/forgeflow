// Runs once before the integration project. Jest loads this file outside its module registry,
// so it may only import packages (no relative imports).
import { loadDotEnv } from '@forgeflow/config';
import { createDatabase, migrateDatabase } from '@forgeflow/database';

/**
 * Prepares the integration test database, with the two connections of ADR-0002:
 * - owner (TEST_MIGRATION_DATABASE_URL, else MIGRATION_DATABASE_URL with "_test" appended to
 *   the database name): recreates the database, applies every migration, and serves the test
 *   fixtures that write rows directly (it bypasses row-level security);
 * - app (TEST_DATABASE_URL, else DATABASE_URL with "_test"): the forgeflow_app role the api
 *   connects as in the tests, exactly as in production.
 * The database is dropped and recreated on every run, so each run starts empty and proves the
 * migrations apply from scratch. Both URLs are exported for the test files.
 */
export default async function globalSetup(): Promise<void> {
  loadDotEnv();
  const ownerUrl = new URL(
    process.env.TEST_MIGRATION_DATABASE_URL ?? deriveTestUrl('MIGRATION_DATABASE_URL'),
  );
  const appUrl = new URL(process.env.TEST_DATABASE_URL ?? deriveTestUrl('DATABASE_URL'));
  const name = databaseName(ownerUrl);
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to recreate database "${name}": integration tests only use databases whose name ends with "_test".`,
    );
  }
  if (databaseName(appUrl) !== name) {
    throw new Error(
      `The app and owner test connections must use the same database (got "${databaseName(appUrl)}" and "${name}").`,
    );
  }

  const adminUrl = new URL(ownerUrl);
  adminUrl.pathname = '/postgres';
  const admin = createDatabase(adminUrl.toString(), { max: 1, onIdleClientError: () => {} });
  try {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    await admin.pool.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
    await admin.pool.query(`CREATE DATABASE ${quoted}`);
  } catch (error) {
    throw new Error(
      `Integration tests need PostgreSQL at ${adminUrl.host}. Start it with "npm run db:up". (${detail(error)})`,
      { cause: error },
    );
  } finally {
    await admin.close();
  }

  await migrateDatabase(ownerUrl.toString());

  const app = createDatabase(appUrl.toString(), { max: 1, onIdleClientError: () => {} });
  try {
    await app.pool.query('SELECT 1');
  } catch (error) {
    throw new Error(
      `The api's database role cannot connect (${detail(error)}). Create it with "npm run db:app-role" (infra/compose/postgres/init/01-app-role.sql).`,
      { cause: error },
    );
  } finally {
    await app.close();
  }

  process.env.TEST_MIGRATION_DATABASE_URL = ownerUrl.toString();
  process.env.TEST_DATABASE_URL = appUrl.toString();
}

function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\//, ''));
}

function deriveTestUrl(variable: 'DATABASE_URL' | 'MIGRATION_DATABASE_URL'): string {
  const base = process.env[variable];
  if (!base) {
    throw new Error(
      `Integration tests need ${variable} (or TEST_${variable}). Locally: npm run dev creates .env from .env.example.`,
    );
  }
  const url = new URL(base);
  url.pathname = `/${encodeURIComponent(`${databaseName(url) || 'forgeflow'}_test`)}`;
  return url.toString();
}

// Connection failures surface as an AggregateError with an empty message; show the code.
function detail(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : ((error as { code?: string }).code ?? 'unknown error');
}
