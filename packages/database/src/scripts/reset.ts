import pg from 'pg';
import { loadDatabaseEnv } from '../env.js';
import { migrateDatabase } from '../migrate.js';

// Drops every ForgeFlow schema and re-applies migrations. Development and test only.
const env = loadDatabaseEnv();
const host = new URL(env.DATABASE_URL).hostname;

if (env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`Refusing to reset database on host "${host}" with NODE_ENV=${env.NODE_ENV}.`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();
try {
  await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
} finally {
  await client.end();
}

await migrateDatabase(env.DATABASE_URL);
console.log('Database reset and migrations applied.');
