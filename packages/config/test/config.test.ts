import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { baseEnvSchema, EnvValidationError, loadDotEnv, parseEnv, z } from '../src/index.js';

describe('parseEnv', () => {
  const schema = baseEnvSchema.extend({
    DATABASE_URL: z.url(),
    PORT: z.coerce.number().int().positive().default(4000),
  });

  it('returns typed values with defaults applied', () => {
    const env = parseEnv(schema, { DATABASE_URL: 'postgres://u:p@localhost:5432/db' });
    expect(env).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      APP_VERSION: 'dev',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      PORT: 4000,
    });
  });

  it('lists every invalid or missing variable', () => {
    let caught: unknown;
    try {
      parseEnv(schema, { NODE_ENV: 'staging', PORT: 'abc' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const keys = (caught as EnvValidationError).problems.map((p) => p.split(':')[0]);
    expect(keys).toEqual(expect.arrayContaining(['NODE_ENV', 'DATABASE_URL', 'PORT']));
  });
});

describe('loadDotEnv', () => {
  it('loads the nearest .env without overwriting existing values', () => {
    const root = mkdtempSync(join(tmpdir(), 'ff-config-'));
    const nested = join(root, 'apps', 'api');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, '.env'), 'A=from-file\nB=from-file\n');

    const target: Record<string, string | undefined> = { A: 'already-set' };
    const file = loadDotEnv(nested, target);

    expect(file).toBe(join(root, '.env'));
    expect(target).toEqual({ A: 'already-set', B: 'from-file' });
  });

  it('does nothing in production', () => {
    const target: Record<string, string | undefined> = { NODE_ENV: 'production' };
    expect(loadDotEnv(process.cwd(), target)).toBeUndefined();
  });
});
