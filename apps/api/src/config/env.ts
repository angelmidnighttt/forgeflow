import { baseEnvSchema, loadDotEnv, parseEnv, z } from '@forgeflow/config';
import { databaseEnvSchema } from '@forgeflow/database';

/** Prefix of the development secret in .env.example; refused in production. */
export const DEV_JWT_SECRET_PREFIX = 'dev-only-';

export const apiEnvSchema = baseEnvSchema
  .extend({
    DATABASE_URL: databaseEnvSchema.shape.DATABASE_URL,
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    /** Browser origin of the web app. State-changing requests from any other origin are rejected. */
    APP_ORIGIN: z.url().default('http://localhost:3000'),
    /** HMAC key that signs access tokens (HS256). Use at least 32 random characters. */
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
    /** Refresh cookie gets the Secure flag and the __Secure- prefix. Defaults to true in production. */
    COOKIE_SECURE: z.stringbool().optional(),
  })
  .refine(
    (env) => env.NODE_ENV !== 'production' || !env.JWT_SECRET.startsWith(DEV_JWT_SECRET_PREFIX),
    {
      path: ['JWT_SECRET'],
      message: 'the development secret from .env.example cannot be used in production',
    },
  );
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(): ApiEnv {
  loadDotEnv();
  return parseEnv(apiEnvSchema);
}
