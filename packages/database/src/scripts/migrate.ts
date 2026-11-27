import { loadMigrationEnv } from '../env.js';
import { migrateDatabase } from '../migrate.js';

const env = loadMigrationEnv();
await migrateDatabase(env.MIGRATION_DATABASE_URL);
console.log('Migrations applied.');
