import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { tokenResponseSchema, type TokenResponse } from '@forgeflow/contracts';
import request from 'supertest';
import type { ApiEnv } from '../../src/config/env.js';
import { testDatabaseUrl } from './test-database.js';

export const APP_ORIGIN = 'http://localhost:3000';
export const JWT_SECRET = 'test-only-jwt-secret-0123456789abcdef';
export const TEST_PASSWORD = 'correct horse battery staple';

/** Environment for an app that talks to the integration test database. */
export function envFor(overrides: Partial<ApiEnv> = {}): ApiEnv {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    APP_VERSION: 'test',
    DATABASE_URL: testDatabaseUrl(),
    API_PORT: 0,
    APP_ORIGIN,
    JWT_SECRET,
    ...overrides,
  };
}

export function setCookieLines(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

export function cookieLine(lines: string[], name: string): string | undefined {
  return lines.find((line) => line.startsWith(`${name}=`));
}

export function cookieValue(lines: string[], name: string): string | undefined {
  const line = cookieLine(lines, name);
  return line === undefined
    ? undefined
    : decodeURIComponent(line.slice(name.length + 1).split(';')[0] ?? '');
}

export function uniqueEmail(): string {
  return `user-${randomUUID()}@example.test`;
}

export interface SignedIn {
  email: string;
  body: TokenResponse;
  lines: string[];
  refreshSecret: string;
  /** Ready to pass to `.set('Cookie', …)`. */
  refreshCookie: string;
}

/** Registers a new account through the API, which also signs it in. */
export async function registerUser(
  app: INestApplication,
  options: { email?: string; password?: string; cookieName?: string } = {},
): Promise<SignedIn> {
  const email = options.email ?? uniqueEmail();
  const cookieName = options.cookieName ?? 'ff_refresh';
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, password: options.password ?? TEST_PASSWORD, name: 'Test User' })
    .expect(201);
  const lines = setCookieLines(res);
  const refreshSecret = cookieValue(lines, cookieName) ?? '';
  return {
    email,
    body: tokenResponseSchema.parse(res.body.data),
    lines,
    refreshSecret,
    refreshCookie: `${cookieName}=${refreshSecret}`,
  };
}
