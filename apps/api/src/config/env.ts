import { baseEnvSchema, loadDotEnv, parseEnv, z } from '@forgeflow/config';
import { databaseEnvSchema } from '@forgeflow/database';

export const apiEnvSchema = baseEnvSchema.extend({
  DATABASE_URL: databaseEnvSchema.shape.DATABASE_URL,
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  /** Browser origin of the web app. State-changing requests from any other origin are rejected. */
  APP_ORIGIN: z.url().default('http://localhost:3000'),
  /** Session cookies get the Secure flag and the __Host- prefix. Defaults to true in production. */
  COOKIE_SECURE: z.stringbool().optional(),
});
export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** Injection token for the validated environment. */
export const API_ENV = Symbol('API_ENV');

export function loadApiEnv(): ApiEnv {
  loadDotEnv();
  return parseEnv(apiEnvSchema);
}
