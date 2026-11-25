import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { tokenResponseSchema } from '@forgeflow/contracts';
import { createDatabase, refreshTokens, users, type DatabaseHandle } from '@forgeflow/database';
import { hash as argon2Hash } from '@node-rs/argon2';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../../../src/app.factory.js';
import { hashRefreshTokenSecret } from '../../../src/common/utils/refresh-token-secret.util.js';
import {
  cookieValue,
  envFor,
  registerUser,
  setCookieLines,
  TEST_PASSWORD,
  uniqueEmail,
} from '../../support/http.js';
import { createUser, testDatabaseUrl } from '../../support/test-database.js';

let database: DatabaseHandle;
let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  database = createDatabase(testDatabaseUrl(), { max: 2 });
  app = await createApp(envFor());
  await app.init();
});

afterAll(async () => {
  await app.close();
  await database.close();
});

async function usersWithEmail(email: string) {
  return database.db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`);
}

async function refreshRow(secret: string) {
  const [row] = await database.db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashRefreshTokenSecret(secret)));
  return row;
}

describe('POST /api/v1/auth/register', () => {
  it('creates the account, signs it in and stores only an argon2id hash of the password', async () => {
    const email = uniqueEmail();
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email: `  ${email.toUpperCase()} `, password: TEST_PASSWORD, name: '  Ann Lee ' })
      .expect(201);

    const body = tokenResponseSchema.parse(res.body.data);
    expect(body.user).toEqual({
      id: body.user.id,
      email,
      name: 'Ann Lee',
      emailVerified: false,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    expect(cookieValue(setCookieLines(res), 'ff_refresh')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [stored] = await usersWithEmail(email);
    expect(stored?.email).toBe(email);
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(stored?.passwordHash).not.toContain(TEST_PASSWORD);

    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
  });

  it('refuses an email that already has an account, whatever its letter case', async () => {
    const { email } = await registerUser(app);
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email: email.toUpperCase(), password: 'another password 123', name: 'Someone' })
      .expect(409);

    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(setCookieLines(res)).toHaveLength(0);
    expect(await usersWithEmail(email)).toHaveLength(1);
  });

  it('lets only one of two simultaneous sign-ups with the same email through', async () => {
    const email = uniqueEmail();
    const attempt = () =>
      http().post('/api/v1/auth/register').send({ email, password: TEST_PASSWORD, name: 'Twin' });
    const statuses = (await Promise.all([attempt(), attempt()])).map((res) => res.status);

    expect(statuses.sort()).toEqual([201, 409]);
    expect(await usersWithEmail(email)).toHaveLength(1);
  });

  it('validates the email, the password length and the name', async () => {
    const cases = [
      [{ email: 'not-an-email', password: TEST_PASSWORD, name: 'A' }, 'email'],
      [{ email: uniqueEmail(), password: 'short', name: 'A' }, 'password'],
      [{ email: uniqueEmail(), password: 'x'.repeat(129), name: 'A' }, 'password'],
      [{ email: uniqueEmail(), password: TEST_PASSWORD, name: '   ' }, 'name'],
      [{ email: uniqueEmail(), password: TEST_PASSWORD }, 'name'],
    ] as const;
    for (const [payload, field] of cases) {
      const res = await http().post('/api/v1/auth/register').send(payload).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: field })]),
      );
    }
  });

  it('refuses sign-ups started by another site', async () => {
    const res = await http()
      .post('/api/v1/auth/register')
      .set('Origin', 'https://attacker.example')
      .send({ email: uniqueEmail(), password: TEST_PASSWORD, name: 'A' })
      .expect(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('signs in with the right password, ignoring email case and surrounding spaces', async () => {
    const { email, body: registered } = await registerUser(app);
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: ` ${email.toUpperCase()}`, password: TEST_PASSWORD })
      .expect(200);

    const body = tokenResponseSchema.parse(res.body.data);
    expect(body.user.id).toBe(registered.user.id);
    expect(cookieValue(setCookieLines(res), 'ff_refresh')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
  });

  it('answers a wrong password and an unknown email the same way', async () => {
    const { email } = await registerUser(app);
    const wrongPassword = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'not the password' })
      .expect(401);
    const unknownEmail = await http()
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail(), password: TEST_PASSWORD })
      .expect(401);

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.body.error).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
        requestId: expect.any(String),
      });
      expect(setCookieLines(res)).toHaveLength(0);
    }
  });

  it('refuses a password login for an account that has no password', async () => {
    const user = await createUser(database.db, { passwordHash: null });
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('starts a separate sign-in per login, so devices refresh and sign out independently', async () => {
    const { email } = await registerUser(app);
    const login = async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      return cookieValue(setCookieLines(res), 'ff_refresh') ?? '';
    };
    const laptop = await login();
    const phone = await login();

    expect((await refreshRow(laptop))?.familyId).not.toBe((await refreshRow(phone))?.familyId);
    await http().post('/api/v1/auth/logout').set('Cookie', `ff_refresh=${laptop}`).expect(204);
    await http().post('/api/v1/auth/refresh').set('Cookie', `ff_refresh=${phone}`).expect(200);
  });

  it('revokes the sign-in this browser held before logging in again', async () => {
    const { email, refreshCookie, refreshSecret } = await registerUser(app);
    await http()
      .post('/api/v1/auth/login')
      .set('Cookie', refreshCookie)
      .send({ email, password: TEST_PASSWORD })
      .expect(200);

    expect((await refreshRow(refreshSecret))?.revokedReason).toBe('logout');
    await http().post('/api/v1/auth/refresh').set('Cookie', refreshCookie).expect(401);
  });

  it('upgrades a password hash made with weaker parameters', async () => {
    const weakHash = await argon2Hash(TEST_PASSWORD, { memoryCost: 4096, timeCost: 1 });
    const user = await createUser(database.db, { passwordHash: weakHash });

    await http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);
    const [stored] = await usersWithEmail(user.email);
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);

    await http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);
  });

  it('validates the request body', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'nope', password: '' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses logins started by another site', async () => {
    const { email } = await registerUser(app);
    const res = await http()
      .post('/api/v1/auth/login')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ email, password: TEST_PASSWORD })
      .expect(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });
});
