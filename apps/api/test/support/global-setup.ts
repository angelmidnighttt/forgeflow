// Runs once before the integration project. Jest loads this file outside its module registry,
// so it may only import packages (no relative imports).
import { loadDotEnv } from '@forgeflow/config';
import { createDatabase, migrateDatabase } from '@forgeflow/database';

/**
 * Picks the integration test database: TEST_DATABASE_URL if set, otherwise DATABASE_URL with
 * "_test" appended to the database name. It is dropped and recreated on every run, then all
 * migrations are applied, so each run starts empty and proves the migrations apply from scratch.
 * The chosen URL is exported as TEST_DATABASE_URL for the test files.
 */
export default async function globalSetup(): Promise<void> {
  loadDotEnv();
  const testUrl = new URL(process.env.TEST_DATABASE_URL ?? deriveTestUrl());
  const name = decodeURIComponent(testUrl.pathname.replace(/^\//, ''));
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to recreate database "${name}": integration tests only use databases whose name ends with "_test".`,
    );
  }

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const admin = createDatabase(adminUrl.toString(), { max: 1, onIdleClientError: () => {} });
  try {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    await admin.pool.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
    await admin.pool.query(`CREATE DATABASE ${quoted}`);
  } catch (error) {
    // Connection failures surface as an AggregateError with an empty message; show the code.
    const detail =
      error instanceof Error && error.message
        ? error.message
        : ((error as { code?: string }).code ?? 'unknown error');
    throw new Error(
      `Integration tests need PostgreSQL at ${adminUrl.host}. Start it with "npm run db:up". (${detail})`,
      { cause: error },
    );
  } finally {
    await admin.close();
  }

  await migrateDatabase(testUrl.toString());
  process.env.TEST_DATABASE_URL = testUrl.toString();
}

function deriveTestUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'Integration tests need DATABASE_URL or TEST_DATABASE_URL. Locally: npm run db:up (npm run dev creates .env).',
    );
  }
  const url = new URL(base);
  const name = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'forgeflow';
  url.pathname = `/${encodeURIComponent(`${name}_test`)}`;
  return url.toString();
}
