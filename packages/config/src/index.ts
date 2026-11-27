import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseEnv as parseDotEnv } from 'node:util';
import { z } from 'zod';

export { z };

/** Settings every ForgeFlow process understands. Apps extend this with their own keys. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_VERSION: z.string().min(1).default('dev'),
});

export class EnvValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(
      [
        'Invalid or missing environment variables:',
        ...problems.map((p) => `  - ${p}`),
        'For local development, copy .env.example to .env (npm run dev does this automatically).',
      ].join('\n'),
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates `source` against `schema` and returns the typed result.
 * Throws EnvValidationError listing every problem, so a process fails at startup instead of later.
 *
 * An empty value (`KEY=`) counts as unset: Docker Compose passes a variable that is listed but left
 * empty in its env file as "", and that must turn an optional setting off, not fail validation.
 */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const set = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = schema.safeParse(set);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    return `${key}: ${issue.message}`;
  });
  throw new EnvValidationError(problems);
}

/**
 * Finds the nearest `.env` walking up from `startDir` and copies its values into `target`
 * without overwriting variables that are already set. Returns the file path, or undefined.
 * Production processes get their settings from the environment, so this is a no-op there.
 */
export function loadDotEnv(
  startDir: string = process.cwd(),
  target: Record<string, string | undefined> = process.env,
): string | undefined {
  if (target.NODE_ENV === 'production') return undefined;
  const file = findUp('.env', startDir);
  if (!file) return undefined;
  const values = parseDotEnv(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (target[key] === undefined) target[key] = value;
  }
  return file;
}

function findUp(name: string, startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
