import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` only reads the schema; it does not connect to the database.
// Migrations are applied by `npm run db:migrate` (src/scripts/migrate.ts), not by drizzle-kit.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
