import { loadDatabaseEnv } from '../env.js';
import { migrateDatabase } from '../migrate.js';

const env = loadDatabaseEnv();
await migrateDatabase(env.DATABASE_URL);
console.log('Migrations applied.');
