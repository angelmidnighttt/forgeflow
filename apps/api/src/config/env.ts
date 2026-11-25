import { baseEnvSchema, loadDotEnv, parseEnv, z } from '@forgeflow/config';
import { databaseEnvSchema } from '@forgeflow/database';

export const apiEnvSchema = baseEnvSchema.extend({
  DATABASE_URL: databaseEnvSchema.shape.DATABASE_URL,
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
});
export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** Injection token for the validated environment. */
export const API_ENV = Symbol('API_ENV');

export function loadApiEnv(): ApiEnv {
  loadDotEnv();
  return parseEnv(apiEnvSchema);
}
