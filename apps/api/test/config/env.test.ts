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

  it('reads TRUST_PROXY as Express expects it', () => {
    const parse = (value?: string) =>
      apiEnvSchema.parse({ ...valid, TRUST_PROXY: value }).TRUST_PROXY;
    expect(parse(undefined)).toBeUndefined();
    expect(parse('false')).toBeUndefined();
    expect(parse('true')).toBe(true);
    expect(parse('1')).toBe(1);
    expect(parse('loopback')).toBe('loopback');
    expect(parse('10.0.0.0/8, 172.16.0.1')).toBe('10.0.0.0/8, 172.16.0.1');
  });

  it('takes GitHub sign-in settings as a pair', () => {
    expect(issuesFor({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' })).toEqual([]);
    expect(issuesFor({ GITHUB_CLIENT_ID: 'id' })).toEqual(['GITHUB_CLIENT_SECRET']);
    expect(issuesFor({ GITHUB_CLIENT_SECRET: 'secret' })).toEqual(['GITHUB_CLIENT_SECRET']);
  });

  it('rejects a MAIL_FROM that is not an address', () => {
    for (const from of [undefined, '', 'ForgeFlow', 'ForgeFlow <no-reply>', 'a@b, c@d']) {
      expect(issuesFor({ MAIL_FROM: from })).toEqual(['MAIL_FROM']);
    }
  });
});
