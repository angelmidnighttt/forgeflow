import { baseEnvSchema, loadDotEnv, parseEnv, z } from '@forgeflow/config';
import { databaseEnvSchema } from '@forgeflow/database';

/** Prefix of the development secret in .env.example; refused in production. */
export const DEV_JWT_SECRET_PREFIX = 'dev-only-';

/** `address@domain` or `Display Name <address@domain>`. */
const MAILBOX_PATTERN = /^(?:[^<>@]*<[^<>@\s]+@[^<>@\s]+>|[^<>@\s]+@[^<>@\s]+)$/;

export const apiEnvSchema = baseEnvSchema
  .extend({
    DATABASE_URL: databaseEnvSchema.shape.DATABASE_URL,
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    /** Browser origin of the web app. State-changing requests from any other origin are rejected. */
    APP_ORIGIN: z.url().default('http://localhost:3000'),
    /**
     * Express "trust proxy": which reverse proxies may set X-Forwarded-For, so `req.ip` (used by
     * rate limits and the sessions list) is the client's address. Unset: no proxy is trusted.
     * A hop count ("1"), "loopback", or addresses/subnets ("10.0.0.0/8, 172.16.0.1").
     */
    TRUST_PROXY: z
      .string()
      .trim()
      .min(1)
      .transform((value): boolean | number | string | undefined => {
        if (value === 'false') return undefined;
        if (value === 'true') return true;
        return /^\d+$/.test(value) ? Number(value) : value;
      })
      .optional(),

    /** HMAC key that signs access tokens (HS256). Use at least 32 random characters. */
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
    /** Refresh cookie gets the Secure flag and the __Secure- prefix. Defaults to true in production. */
    COOKIE_SECURE: z.stringbool().optional(),

    /** SMTP server for outgoing email, e.g. smtp://localhost:1025 or smtps://user:pass@host:465. */
    SMTP_URL: z.url({ protocol: /^smtps?$/, error: 'must be an smtp:// or smtps:// URL' }),
    /** Sender of outgoing email: an address, optionally with a display name (`Name <address>`). */
    MAIL_FROM: z
      .string()
      .regex(MAILBOX_PATTERN, 'must be an email address, optionally as "Name <address>"'),
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
