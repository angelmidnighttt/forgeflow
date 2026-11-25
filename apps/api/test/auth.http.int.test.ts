import { randomBytes } from 'node:crypto';
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
import { sessionViewSchema } from '@forgeflow/contracts';
import { createDatabase, sessions, type DatabaseHandle } from '@forgeflow/database';
import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import type { ApiEnv } from '../src/config/env.js';
import { Public } from '../src/identity/auth.decorators.js';
import { IdentityModule } from '../src/identity/identity.module.js';
import { SessionCookies } from '../src/identity/session-cookies.js';
import { SessionService } from '../src/identity/session.service.js';
import { createUser, testDatabaseUrl } from './support/test-database.js';

const APP_ORIGIN = 'http://localhost:3000';

/** Stands in for the sign-in endpoint (a later Phase 1 item): issues a session for a user id. */
@Public()
@Controller('test')
class TestSignInController {
  constructor(
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Inject(SessionCookies) private readonly cookies: SessionCookies,
  ) {}

  @Post('sign-in')
  async signIn(
    @Body() body: { userId: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const issued = await this.sessionService.create(body.userId, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    this.cookies.set(res, issued);
    return { sessionId: issued.session.id };
  }
}

@Module({ imports: [IdentityModule], controllers: [TestSignInController] })
class TestSignInModule {}

function envFor(overrides: Partial<ApiEnv> = {}): ApiEnv {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    APP_VERSION: 'test',
    DATABASE_URL: testDatabaseUrl(),
    API_PORT: 0,
    APP_ORIGIN,
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

async function signIn(app: INestApplication, names = { session: 'ff_session', csrf: 'ff_csrf' }) {
  const user = await createUser(database.db);
  const res = await request(app.getHttpServer())
    .post('/api/v1/test/sign-in')
    .send({ userId: user.id })
    .expect(201);
  const lines = setCookieLines(res);
  const token = cookieValue(lines, names.session) ?? '';
  const csrf = cookieValue(lines, names.csrf) ?? '';
  return {
    user,
    lines,
    csrf,
    sessionId: res.body.data.sessionId as string,
    cookie: `${names.session}=${token}; ${names.csrf}=${csrf}`,
  };
}

describe('session cookies and CSRF protection', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp(envFor(), { imports: [TestSignInModule] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets an HttpOnly, SameSite=Lax session cookie and a CSRF cookie the page can read', async () => {
    const { lines } = await signIn(app);
    const session = cookieLine(lines, 'ff_session') ?? '';
    const csrf = cookieLine(lines, 'ff_csrf') ?? '';

    expect(session).toMatch(/; HttpOnly/i);
    expect(session).toMatch(/; SameSite=Lax/i);
    expect(session).toMatch(/; Path=\//);
    expect(session).toMatch(/; Expires=/);
    expect(session).not.toMatch(/; Secure/i);
    expect(csrf).not.toMatch(/; HttpOnly/i);
    expect(csrf).toMatch(/; SameSite=Lax/i);
  });

  it('rejects GET /auth/session without a session cookie', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/session').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns the signed-in user and the CSRF token from the cookie', async () => {
    const { user, cookie, csrf, sessionId } = await signIn(app);
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Cookie', cookie)
      .expect(200);

    const view = sessionViewSchema.parse(res.body.data);
    expect(view.user).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: false,
    });
    expect(view.session.id).toBe(sessionId);
    expect(view.csrfToken).toBe(csrf);
  });

  it('rejects an unknown session token and clears both cookies', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Cookie', `ff_session=${randomBytes(32).toString('base64url')}`)
      .expect(401);

    const lines = setCookieLines(res);
    expect(cookieLine(lines, 'ff_session')).toMatch(/^ff_session=;.*Expires=Thu, 01 Jan 1970/);
    expect(cookieLine(lines, 'ff_csrf')).toMatch(/^ff_csrf=;.*Expires=Thu, 01 Jan 1970/);
  });

  it('refuses logout without the CSRF header and keeps the session', async () => {
    const { cookie } = await signIn(app);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .expect(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');

    await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Cookie', cookie)
      .expect(200);
  });

  it('refuses logout with a wrong CSRF token', async () => {
    const { cookie } = await signIn(app);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', randomBytes(32).toString('base64url'))
      .expect(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('refuses cross-site requests even when the CSRF token is right', async () => {
    const { cookie, csrf } = await signIn(app);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .set('Sec-Fetch-Site', 'cross-site')
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .set('Origin', 'https://attacker.example')
      .expect(403);
  });

  it('refuses state-changing requests from another origin before anyone is signed in', async () => {
    const user = await createUser(database.db);
    const res = await request(app.getHttpServer())
      .post('/api/v1/test/sign-in')
      .set('Origin', 'https://attacker.example')
      .send({ userId: user.id })
      .expect(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('logs out: deletes the session, clears both cookies and the old cookie stops working', async () => {
    const { cookie, csrf, sessionId } = await signIn(app);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .set('Origin', APP_ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin')
      .expect(204);

    const lines = setCookieLines(res);
    expect(cookieLine(lines, 'ff_session')).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(cookieLine(lines, 'ff_csrf')).toMatch(/Expires=Thu, 01 Jan 1970/);
    const [row] = await database.db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(row).toBeUndefined();

    await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Cookie', cookie)
      .expect(401);
  });
});

describe('with COOKIE_SECURE on', () => {
  it('uses __Host- cookies with the Secure flag', async () => {
    const app = await createApp(envFor({ COOKIE_SECURE: true }), { imports: [TestSignInModule] });
    await app.init();
    try {
      const { lines } = await signIn(app, { session: '__Host-ff_session', csrf: '__Host-ff_csrf' });
      const session = cookieLine(lines, '__Host-ff_session') ?? '';
      const csrf = cookieLine(lines, '__Host-ff_csrf') ?? '';

      expect(session).toMatch(/; Secure/i);
      expect(session).toMatch(/; HttpOnly/i);
      expect(session).toMatch(/; Path=\//);
      expect(session).not.toMatch(/; Domain=/i);
      expect(csrf).toMatch(/; Secure/i);
    } finally {
      await app.close();
    }
  });
});
