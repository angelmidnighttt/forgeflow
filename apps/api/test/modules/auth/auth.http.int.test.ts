import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { authUserSchema, tokenResponseSchema } from '@forgeflow/contracts';
import { createDatabase, refreshTokens, type DatabaseHandle } from '@forgeflow/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../../../src/app.factory.js';
import { TOKEN_POLICY } from '../../../src/common/constants/auth.constants.js';
import { hashSecretToken } from '../../../src/common/utils/secret-token.util.js';
import { AccessTokenService } from '../../../src/modules/auth/access-token.service.js';
import {
  APP_ORIGIN,
  cookieLine,
  cookieValue,
  envFor,
  registerUser,
  setCookieLines,
} from '../../support/http.js';
import { createUser, testDatabaseUrl } from '../../support/test-database.js';

let database: DatabaseHandle;

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { max: 2 });
});

afterAll(async () => {
  await database.close();
});

describe('JWT access tokens and refresh cookie', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const signIn = () => registerUser(app);

  beforeAll(async () => {
    app = await createApp(envFor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('signing in returns a Bearer access token and sets a locked-down refresh cookie', async () => {
    const { lines, body } = await signIn();
    const cookie = cookieLine(lines, 'ff_refresh') ?? '';

    expect(body.tokenType).toBe('Bearer');
    expect(body.accessToken.split('.')).toHaveLength(3);
    expect(cookie).toMatch(/; HttpOnly/i);
    expect(cookie).toMatch(/; SameSite=Strict/i);
    expect(cookie).toMatch(/; Path=\/api\/v1\/auth(;|$)/);
    expect(cookie).toMatch(/; Expires=/);
    expect(cookie).not.toMatch(/; Secure/i);
    expect(lines).toHaveLength(1);
  });

  it('GET /auth/me needs a Bearer token', async () => {
    const res = await http().get('/api/v1/auth/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.headers['www-authenticate']).toBe('Bearer realm="forgeflow"');
  });

  it('GET /auth/me returns the user for a valid access token', async () => {
    const { body, email } = await signIn();
    const res = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    expect(authUserSchema.parse(res.body.data)).toEqual({
      id: body.user.id,
      email,
      name: 'Test User',
      emailVerified: false,
    });
  });

  it('does not accept the refresh cookie as a credential for API calls', async () => {
    const { refreshCookie } = await signIn();
    await http().get('/api/v1/auth/me').set('Cookie', refreshCookie).expect(401);
  });

  it('rejects malformed and tampered access tokens', async () => {
    const { body } = await signIn();
    for (const header of [
      'Bearer not-a-jwt',
      `Basic ${body.accessToken}`,
      `Bearer ${body.accessToken.slice(0, -2)}xx`,
    ]) {
      const res = await http().get('/api/v1/auth/me').set('Authorization', header).expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('tells the client when the access token expired', async () => {
    const user = await createUser(database.db);
    const signedEarlier = new AccessTokenService(
      envFor(),
      () => new Date(Date.now() - (TOKEN_POLICY.accessTokenTtlSeconds + 60) * 1000),
    );
    const { token } = await signedEarlier.sign(user.id);

    const res = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    expect(res.headers['www-authenticate']).toBe('Bearer realm="forgeflow", error="invalid_token"');
  });

  it('public routes ignore a bad token instead of failing', async () => {
    await http().get('/api/v1/health').set('Authorization', 'Bearer not-a-jwt').expect(200);
  });

  it('POST /auth/refresh swaps the refresh cookie for a new one and a new access token', async () => {
    const { refreshCookie, refreshSecret, body: first } = await signIn();
    const res = await http().post('/api/v1/auth/refresh').set('Cookie', refreshCookie).expect(200);

    const body = tokenResponseSchema.parse(res.body.data);
    const newSecret = cookieValue(setCookieLines(res), 'ff_refresh');
    expect(body.accessToken).not.toBe(first.accessToken);
    expect(newSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSecret).not.toBe(refreshSecret);
    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
  });

  it('POST /auth/refresh without a cookie asks the user to sign in', async () => {
    const res = await http().post('/api/v1/auth/refresh').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('a refresh token reused right after rotation gets 409 and the sign-in survives', async () => {
    const { refreshCookie } = await signIn();
    const rotated = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);
    const newCookie = `ff_refresh=${cookieValue(setCookieLines(rotated), 'ff_refresh')}`;

    const res = await http().post('/api/v1/auth/refresh').set('Cookie', refreshCookie).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
    await http().post('/api/v1/auth/refresh').set('Cookie', newCookie).expect(200);
  });

  it('a refresh token reused after the grace window signs the whole sign-in out', async () => {
    const { refreshCookie, refreshSecret } = await signIn();
    const rotated = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);
    const newCookie = `ff_refresh=${cookieValue(setCookieLines(rotated), 'ff_refresh')}`;

    // Pretend the old token was replaced long ago, as when an attacker replays a stolen copy.
    await database.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(Date.now() - TOKEN_POLICY.refreshReuseGraceMs - 60_000) })
      .where(eq(refreshTokens.tokenHash, hashSecretToken(refreshSecret)));

    const res = await http().post('/api/v1/auth/refresh').set('Cookie', refreshCookie).expect(401);
    expect(cookieLine(setCookieLines(res), 'ff_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
    await http().post('/api/v1/auth/refresh').set('Cookie', newCookie).expect(401);
  });

  it('refuses refresh requests started by another site', async () => {
    const { refreshCookie } = await signIn();
    for (const [header, value] of [
      ['Origin', 'https://attacker.example'],
      ['Sec-Fetch-Site', 'cross-site'],
    ] as const) {
      const res = await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie)
        .set(header, value)
        .expect(403);
      expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    }
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .set('Origin', APP_ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin')
      .expect(200);
  });

  it('logout revokes the sign-in, clears the cookie and the refresh token stops working', async () => {
    const { refreshCookie, refreshSecret } = await signIn();
    const res = await http().post('/api/v1/auth/logout').set('Cookie', refreshCookie).expect(204);

    expect(cookieLine(setCookieLines(res), 'ff_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
    const [row] = await database.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashSecretToken(refreshSecret)));
    expect(row?.revokedReason).toBe('logout');
    await http().post('/api/v1/auth/refresh').set('Cookie', refreshCookie).expect(401);
  });
});

describe('with COOKIE_SECURE on', () => {
  it('uses a __Secure- refresh cookie with the Secure flag', async () => {
    const app = await createApp(envFor({ COOKIE_SECURE: true }));
    await app.init();
    try {
      const { lines } = await registerUser(app, { cookieName: '__Secure-ff_refresh' });
      const cookie = cookieLine(lines, '__Secure-ff_refresh') ?? '';
      expect(cookie).toMatch(/; Secure/i);
      expect(cookie).toMatch(/; HttpOnly/i);
      expect(cookie).toMatch(/; SameSite=Strict/i);
      expect(cookie).toMatch(/; Path=\/api\/v1\/auth(;|$)/);
    } finally {
      await app.close();
    }
  });
});
