import { createPrivateKey, type KeyObject } from 'node:crypto';
import { baseEnvSchema, loadDotEnv, parseEnv, z } from '@forgeflow/config';
import { databaseEnvSchema } from '@forgeflow/database';
import { parseKeyring } from '../common/utils/envelope.util.js';

/** Prefix of the development secret in .env.example; refused in production. */
export const DEV_JWT_SECRET_PREFIX = 'dev-only-';

/** The development key in .env.example ("dev-only-local-secret-key-012345"); refused in production. */
export const DEV_SECRET_ENCRYPTION_KEY = Buffer.from('dev-only-local-secret-key-012345');

/**
 * SECRET_ENCRYPTION_KEYS: the keys (KEKs) that wrap the data key of every integration secret, as
 * `<version>:<base64 of 32 random bytes>`, comma-separated. The highest version encrypts new
 * secrets; the others keep opening older ones until `npm run secrets:rewrap` moves them over.
 */
export const secretEncryptionKeysSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx) => {
    const keyring = parseKeyring(value);
    if (typeof keyring === 'string') {
      ctx.issues.push({ code: 'custom', message: keyring, input: value });
      return z.NEVER;
    }
    return keyring;
  });

/**
 * GITHUB_APP_PRIVATE_KEY: the PEM GitHub gives (PKCS#1 or PKCS#8), on one line with "\n" for its
 * line breaks, or base64-encoded. Read into a key object, so a broken key fails at startup.
 */
const githubAppPrivateKeySchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx): KeyObject => {
    const pem = value.includes('-----BEGIN')
      ? value.replaceAll('\\n', '\n')
      : Buffer.from(value, 'base64').toString('utf8');
    try {
      return createPrivateKey(pem);
    } catch {
      ctx.issues.push({ code: 'custom', message: 'is not a PEM private key', input: value });
      return z.NEVER;
    }
  });

/** The GitHub App settings; all of them or none (the app's features are then off). */
const GITHUB_APP_KEYS = [
  'GITHUB_APP_ID',
  'GITHUB_APP_SLUG',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_WEBHOOK_SECRET',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
] as const;

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
    SECRET_ENCRYPTION_KEYS: secretEncryptionKeysSchema,
    /** Refresh cookie gets the Secure flag and the __Secure- prefix. Defaults to true in production. */
    COOKIE_SECURE: z.stringbool().optional(),

    /** SMTP server for outgoing email, e.g. smtp://localhost:1025 or smtps://user:pass@host:465. */
    SMTP_URL: z.url({ protocol: /^smtps?$/, error: 'must be an smtp:// or smtps:// URL' }),
    /** Sender of outgoing email: an address, optionally with a display name (`Name <address>`). */
    MAIL_FROM: z
      .string()
      .regex(MAILBOX_PATTERN, 'must be an email address, optionally as "Name <address>"'),

    /**
     * GitHub OAuth app for "Sign in with GitHub". Leave both unset to turn it off. The app's
     * callback URL must be `<APP_ORIGIN>/api/v1/auth/github/callback`.
     */
    GITHUB_CLIENT_ID: z.string().trim().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().trim().min(1).optional(),
    /** Where GitHub's OAuth pages and REST API are; change only for GitHub Enterprise Server. */
    GITHUB_URL: z.url().default('https://github.com'),
    GITHUB_API_URL: z.url().default('https://api.github.com'),

    /**
     * The GitHub App that reports deployments (infra/staging/README.md, "GitHub App"). Its
     * webhook URL is <APP_ORIGIN>/api/v1/webhooks/github and its setup URL, with "Request user
     * authorization (OAuth) during installation" on, <APP_ORIGIN>/api/v1/github/setup.
     */
    GITHUB_APP_ID: z.string().regex(/^\d+$/, 'must be the numeric App ID').optional(),
    /** The app's URL name: github.com/apps/<slug>. */
    GITHUB_APP_SLUG: z.string().trim().min(1).optional(),
    GITHUB_APP_PRIVATE_KEY: githubAppPrivateKeySchema.optional(),
    /** Signs the webhooks GitHub sends (X-Hub-Signature-256). */
    GITHUB_APP_WEBHOOK_SECRET: z.string().min(16, 'must be at least 16 characters').optional(),
    /** The app's own OAuth client, used to check that the installing user owns the installation. */
    GITHUB_APP_CLIENT_ID: z.string().trim().min(1).optional(),
    GITHUB_APP_CLIENT_SECRET: z.string().trim().min(1).optional(),
  })
  .refine(
    (env) => env.NODE_ENV !== 'production' || !env.JWT_SECRET.startsWith(DEV_JWT_SECRET_PREFIX),
    {
      path: ['JWT_SECRET'],
      message: 'the development secret from .env.example cannot be used in production',
    },
  )
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      ![...env.SECRET_ENCRYPTION_KEYS.keys.values()].some((key) =>
        key.equals(DEV_SECRET_ENCRYPTION_KEY),
      ),
    {
      path: ['SECRET_ENCRYPTION_KEYS'],
      message: 'the development key from .env.example cannot be used in production',
    },
  )
  .refine(
    (env) => (env.GITHUB_CLIENT_ID === undefined) === (env.GITHUB_CLIENT_SECRET === undefined),
    {
      path: ['GITHUB_CLIENT_SECRET'],
      message: 'set both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or neither',
    },
  )
  .refine(
    (env) => {
      const set = GITHUB_APP_KEYS.filter((key) => env[key] !== undefined).length;
      return set === 0 || set === GITHUB_APP_KEYS.length;
    },
    {
      path: ['GITHUB_APP_ID'],
      message: `set all of ${GITHUB_APP_KEYS.join(', ')}, or none`,
    },
  );
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(): ApiEnv {
  loadDotEnv();
  return parseEnv(apiEnvSchema);
}
