import { createDatabase } from '../index.js';
import { loadMigrationEnv } from '../env.js';

// Inserts development data. Phase 0 has no domain tables yet, so there is nothing to insert;
// Phase 1 adds a sample organization, users and project here.
const env = loadMigrationEnv();
const database = createDatabase(env.MIGRATION_DATABASE_URL, {
  applicationName: 'forgeflow-seed',
  max: 1,
});
try {
  await database.pool.query('SELECT 1');
  console.log('Seed: no seed data defined yet (Phase 0).');
} finally {
  await database.close();
}
