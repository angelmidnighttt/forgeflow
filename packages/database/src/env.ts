import { baseEnvSchema, loadDotEnv, parseEnv, z } from '@forgeflow/config';

const postgresUrl = () => z.url({ protocol: /^postgres(ql)?$/ });

/**
 * The api's connection: the `forgeflow_app` role, which row-level security applies to
 * (docs/adr/ADR-0002).
 */
export const databaseEnvSchema = baseEnvSchema.extend({
  DATABASE_URL: postgresUrl(),
});
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

/**
 * The owner's connection, for migrate / reset / seed: it owns the tables and bypasses
 * row-level security. Never given to the api.
 */
export const migrationEnvSchema = baseEnvSchema.extend({
  MIGRATION_DATABASE_URL: postgresUrl(),
});
export type MigrationEnv = z.infer<typeof migrationEnvSchema>;

/** Environment for the database scripts (migrate, reset, seed). */
export function loadMigrationEnv(): MigrationEnv {
  loadDotEnv();
  return parseEnv(migrationEnvSchema);
}
