import { describe, expect, it } from '@jest/globals';
import { apiEnvSchema } from '../../src/config/env.js';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://forgeflow:forgeflow@localhost:5432/forgeflow',
  JWT_SECRET: 'dev-only-local-jwt-secret-change-me-0123456789',
  SMTP_URL: 'smtp://localhost:1025',
  MAIL_FROM: 'ForgeFlow <no-reply@forgeflow.localhost>',
};

function issuesFor(overrides: Record<string, string | undefined>): string[] {
  const result = apiEnvSchema.safeParse({ ...valid, ...overrides });
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('apiEnvSchema', () => {
  it('accepts the values from .env.example', () => {
    expect(issuesFor({})).toEqual([]);
  });

  it('accepts smtp:// and smtps:// URLs, with or without credentials', () => {
    for (const url of ['smtp://localhost:1025', 'smtps://user:p%40ss@smtp.example.com:465']) {
      expect(issuesFor({ SMTP_URL: url })).toEqual([]);
    }
  });

  it('rejects a missing SMTP_URL or one with another scheme', () => {
    for (const url of [undefined, 'http://localhost:1025', 'localhost:1025']) {
      expect(issuesFor({ SMTP_URL: url })).toEqual(['SMTP_URL']);
    }
  });

  it('accepts MAIL_FROM as a bare address or as "Name <address>"', () => {
    for (const from of ['no-reply@forgeflow.dev', 'ForgeFlow <no-reply@forgeflow.dev>']) {
      expect(issuesFor({ MAIL_FROM: from })).toEqual([]);
    }
  });

  it('rejects a MAIL_FROM that is not an address', () => {
    for (const from of [undefined, '', 'ForgeFlow', 'ForgeFlow <no-reply>', 'a@b, c@d']) {
      expect(issuesFor({ MAIL_FROM: from })).toEqual(['MAIL_FROM']);
    }
  });
});
