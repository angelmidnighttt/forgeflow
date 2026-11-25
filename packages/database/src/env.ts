import { baseEnvSchema, loadDotEnv, parseEnv, z } from '@forgeflow/config';

export const databaseEnvSchema = baseEnvSchema.extend({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

/** Environment for the database scripts (migrate, reset, seed). */
export function loadDatabaseEnv(): DatabaseEnv {
  loadDotEnv();
  return parseEnv(databaseEnvSchema);
}
