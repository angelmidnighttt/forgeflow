import {
  Body,
  Controller,
  Inject,
  Module,
  Post,
  Req,
  Res,
  type INestApplication,
} from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { authUserSchema, tokenResponseSchema } from '@forgeflow/contracts';
import { createDatabase, refreshTokens, type DatabaseHandle } from '@forgeflow/database';
import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import request from 'supertest';
import { createApp } from '../../../src/app.factory.js';
import { TOKEN_POLICY } from '../../../src/common/constants/auth.constants.js';
import { Public } from '../../../src/common/decorators/public.decorator.js';
import { clientInfoFrom } from '../../../src/common/utils/client-info.util.js';
import { hashRefreshTokenSecret } from '../../../src/common/utils/refresh-token-secret.util.js';
import type { ApiEnv } from '../../../src/config/env.js';
import { AccessTokenService } from '../../../src/modules/auth/access-token.service.js';
import { AuthModule } from '../../../src/modules/auth/auth.module.js';
import { AuthService, toTokenResponse } from '../../../src/modules/auth/auth.service.js';
import { RefreshCookieService } from '../../../src/modules/auth/refresh-cookie.service.js';
import { UsersModule } from '../../../src/modules/users/users.module.js';
import { UsersService } from '../../../src/modules/users/users.service.js';
import { createUser, testDatabaseUrl } from '../../support/test-database.js';

const APP_ORIGIN = 'http://localhost:3000';
const JWT_SECRET = 'test-only-jwt-secret-0123456789abcdef';

/** Stands in for the sign-in endpoint (a later Phase 1 item): issues tokens for a user id. */
@Public()
@Controller('test')
class TestSignInController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(RefreshCookieService) private readonly cookie: RefreshCookieService,
  ) {}

  @Post('sign-in')
  async signIn(
    @Body() body: { userId: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.users.findById(body.userId);
    if (!user) throw new Error('unknown user');
    const tokens = await this.auth.issueTokens(user, clientInfoFrom(req));
    this.cookie.set(res, tokens.refresh);
    return toTokenResponse(tokens);
  }
}

@Module({ imports: [AuthModule, UsersModule], controllers: [TestSignInController] })
class TestSignInModule {}

function envFor(overrides: Partial<ApiEnv> = {}): ApiEnv {
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

function setCookieLines(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function cookieLine(lines: string[], name: string): string | undefined {
  return lines.find((line) => line.startsWith(`${name}=`));
}

function cookieValue(lines: string[], name: string): string | undefined {
  const line = cookieLine(lines, name);
  return line === undefined
    ? undefined
    : decodeURIComponent(line.slice(name.length + 1).split(';')[0] ?? '');
}

let database: DatabaseHandle;

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { max: 2 });
});

afterAll(async () => {
  await database.close();
});

async function signIn(app: INestApplication, cookieName = 'ff_refresh') {
  const user = await createUser(database.db);
  const res = await request(app.getHttpServer())
    .post('/api/v1/test/sign-in')
    .send({ userId: user.id })
    .expect(201);
  const lines = setCookieLines(res);
  const refreshSecret = cookieValue(lines, cookieName) ?? '';
  return {
    user,
    lines,
    refreshSecret,
    refreshCookie: `${cookieName}=${refreshSecret}`,
    body: tokenResponseSchema.parse(res.body.data),
  };
}

describe('JWT access tokens and refresh cookie', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp(envFor(), { imports: [TestSignInModule] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('signing in returns a Bearer access token and sets a locked-down refresh cookie', async () => {
    const { lines, body, user } = await signIn(app);
    const cookie = cookieLine(lines, 'ff_refresh') ?? '';

    expect(body.tokenType).toBe('Bearer');
    expect(body.accessToken.split('.')).toHaveLength(3);
    expect(body.user.id).toBe(user.id);
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
    const { body, user } = await signIn(app);
    const res = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    expect(authUserSchema.parse(res.body.data)).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: false,
    });
  });

  it('does not accept the refresh cookie as a credential for API calls', async () => {
    const { refreshCookie } = await signIn(app);
    await http().get('/api/v1/auth/me').set('Cookie', refreshCookie).expect(401);
  });

  it('rejects malformed and tampered access tokens', async () => {
    const { body } = await signIn(app);
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
    const { refreshCookie, refreshSecret, body: first } = await signIn(app);
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
    const { refreshCookie } = await signIn(app);
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
    const { refreshCookie, refreshSecret } = await signIn(app);
    const rotated = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);
    const newCookie = `ff_refresh=${cookieValue(setCookieLines(rotated), 'ff_refresh')}`;

    // Pretend the old token was replaced long ago, as when an attacker replays a stolen copy.
    await database.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(Date.now() - TOKEN_POLICY.refreshReuseGraceMs - 60_000) })
      .where(eq(refreshTokens.tokenHash, hashRefreshTokenSecret(refreshSecret)));

    const res = await http().post('/api/v1/auth/refresh').set('Cookie', refreshCookie).expect(401);
    expect(cookieLine(setCookieLines(res), 'ff_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
    await http().post('/api/v1/auth/refresh').set('Cookie', newCookie).expect(401);
  });

  it('refuses refresh requests started by another site', async () => {
    const { refreshCookie } = await signIn(app);
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
    const { refreshCookie, refreshSecret } = await signIn(app);
    const res = await http().post('/api/v1/auth/logout').set('Cookie', refreshCookie).expect(204);

    expect(cookieLine(setCookieLines(res), 'ff_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
    const [row] = await database.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashRefreshTokenSecret(refreshSecret)));
    expect(row?.revokedReason).toBe('logout');
    await http().post('/api/v1/auth/refresh').set('Cookie', refreshCookie).expect(401);
  });
});

describe('with COOKIE_SECURE on', () => {
  it('uses a __Secure- refresh cookie with the Secure flag', async () => {
    const app = await createApp(envFor({ COOKIE_SECURE: true }), { imports: [TestSignInModule] });
    await app.init();
    try {
      const { lines } = await signIn(app, '__Secure-ff_refresh');
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
