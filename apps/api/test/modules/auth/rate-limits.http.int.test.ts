import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createApp } from '../../../src/app.factory.js';
import { RATE_LIMITS } from '../../../src/common/constants/rate-limit.constants.js';
import {
  bearer,
  client,
  envFor,
  randomIp,
  registerUser,
  TEST_PASSWORD,
  uniqueEmail,
} from '../../support/http.js';
import { countEmailsTo, linkIn, testSmtpUrl, waitForEmailTo } from '../../support/mailpit.js';

let app: INestApplication;

beforeAll(async () => {
  app = await createApp(envFor({ SMTP_URL: testSmtpUrl() }));
  await app.init();
});

afterAll(async () => {
  await app.close();
});

const register = (ip: string, email = uniqueEmail()) =>
  client(app, ip)
    .post('/api/v1/auth/register')
    .send({ email, password: TEST_PASSWORD, name: 'Rate' });
const login = (email: string, password: string, ip?: string) =>
  client(app, ip).post('/api/v1/auth/login').send({ email, password });

describe('per-IP limits', () => {
  it('refuses sign-ups past the limit with 429 and Retry-After, for that address only', async () => {
    const ip = randomIp();
    for (let i = 0; i < RATE_LIMITS.registerPerIp.limit; i++) await register(ip).expect(201);

    const res = await register(ip).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.body.error.details.retryAfterSeconds).toBe(Number(res.headers['retry-after']));

    await register(randomIp()).expect(201);
  });

  it('does not count requests refused by the origin check', async () => {
    const ip = randomIp();
    for (let i = 0; i < RATE_LIMITS.registerPerIp.limit + 2; i++) {
      await register(ip).set('Origin', 'https://attacker.example').expect(403);
    }
    await register(ip).expect(201);
  });
});

describe('login lockout per email', () => {
  it('locks the email after too many attempts, even for the right password, and only that email', async () => {
    const user = await registerUser(app);
    for (let i = 0; i < RATE_LIMITS.loginPerEmail.limit; i++) {
      await login(user.email, 'wrong password').expect(401);
    }

    const locked = await login(user.email, TEST_PASSWORD).expect(429);
    expect(locked.body.error.code).toBe('RATE_LIMITED');
    expect(locked.headers['retry-after']).toBeDefined();
    // From another address too: the lock is on the account, not the client.
    await login(user.email.toUpperCase(), TEST_PASSWORD, randomIp()).expect(429);

    const other = await registerUser(app);
    await login(other.email, TEST_PASSWORD).expect(200);
  });

  it('locks an email without an account the same way', async () => {
    const email = uniqueEmail();
    for (let i = 0; i < RATE_LIMITS.loginPerEmail.limit; i++) {
      await login(email, 'whatever password').expect(401);
    }
    await login(email, 'whatever password').expect(429);
  });

  it('a successful login starts the count over', async () => {
    const user = await registerUser(app);
    for (let i = 0; i < RATE_LIMITS.loginPerEmail.limit - 1; i++) {
      await login(user.email, 'wrong password').expect(401);
    }
    await login(user.email, TEST_PASSWORD).expect(200);
    for (let i = 0; i < RATE_LIMITS.loginPerEmail.limit - 1; i++) {
      await login(user.email, 'wrong password').expect(401);
    }
    await login(user.email, TEST_PASSWORD).expect(200);
  });

  it('resetting the password lifts the lock', async () => {
    const user = await registerUser(app);
    for (let i = 0; i <= RATE_LIMITS.loginPerEmail.limit; i++) {
      await login(user.email, 'wrong password');
    }
    await login(user.email, TEST_PASSWORD).expect(429);

    await client(app).post('/api/v1/auth/password/forgot').send({ email: user.email }).expect(204);
    const { token } = linkIn(
      await waitForEmailTo(user.email, { subject: 'Reset your ForgeFlow password' }),
    );
    await client(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: 'the new password' })
      .expect(204);

    await login(user.email, 'the new password').expect(200);
  });
});

describe('per-email and per-user limits', () => {
  it('sends at most a few reset emails per address, answering 204 every time', async () => {
    const user = await registerUser(app);
    const requests = RATE_LIMITS.forgotPasswordPerEmail.limit + 2;
    for (let i = 0; i < requests; i++) {
      await client(app)
        .post('/api/v1/auth/password/forgot')
        .send({ email: user.email })
        .expect(204);
    }

    await waitForEmailTo(user.email, {
      subject: 'Reset your ForgeFlow password',
      count: RATE_LIMITS.forgotPasswordPerEmail.limit,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await countEmailsTo(user.email, 'Reset your ForgeFlow password')).toBe(
      RATE_LIMITS.forgotPasswordPerEmail.limit,
    );
  });

  it('limits password change attempts per user, from any address', async () => {
    const user = await registerUser(app);
    const attempt = () =>
      client(app)
        .post('/api/v1/auth/password/change')
        .set('Authorization', bearer(user))
        .send({ currentPassword: 'guess', newPassword: 'whatever new password' });

    for (let i = 0; i < RATE_LIMITS.changePasswordPerUser.limit; i++) await attempt().expect(400);
    await attempt().expect(429);
  });
});

describe('without TRUST_PROXY', () => {
  it('ignores X-Forwarded-For, so a client cannot dodge per-IP limits by faking it', async () => {
    const direct = await createApp(envFor({ TRUST_PROXY: undefined }));
    await direct.init();
    try {
      const statuses: number[] = [];
      for (let i = 0; i <= RATE_LIMITS.registerPerIp.limit; i++) {
        const res = await client(direct, randomIp())
          .post('/api/v1/auth/register')
          .send({ email: uniqueEmail(), password: TEST_PASSWORD, name: 'Direct' });
        statuses.push(res.status);
      }
      expect(statuses.at(-1)).toBe(429);
    } finally {
      await direct.close();
    }
  });
});
