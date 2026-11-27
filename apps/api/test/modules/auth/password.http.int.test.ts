import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { tokenResponseSchema } from '@forgeflow/contracts';
import { createDatabase, users, userTokens, type DatabaseHandle } from '@forgeflow/database';
import { eq } from 'drizzle-orm';
import { createApp } from '../../../src/app.factory.js';
import {
  APP_ORIGIN,
  bearer,
  cookieValue,
  envFor,
  loginUser,
  registerUser,
  setCookieLines,
  TEST_PASSWORD,
  uniqueEmail,
  client,
} from '../../support/http.js';
import { countEmailsTo, linkIn, testSmtpUrl, waitForEmailTo } from '../../support/mailpit.js';
import { createUser, testOwnerDatabaseUrl } from '../../support/test-database.js';

const RESET_SUBJECT = 'Reset your ForgeFlow password';
const CHANGED_SUBJECT = 'Your ForgeFlow password was changed';
const NEW_PASSWORD = 'a brand new passphrase';

let database: DatabaseHandle;
let app: INestApplication;
const http = () => client(app);

beforeAll(async () => {
  database = createDatabase(testOwnerDatabaseUrl(), { max: 2 });
  app = await createApp(envFor({ SMTP_URL: testSmtpUrl() }));
  await app.init();
});

afterAll(async () => {
  await app.close();
  await database.close();
});

const forgot = (email: string) => http().post('/api/v1/auth/password/forgot').send({ email });
const reset = (token: string, password = NEW_PASSWORD) =>
  http().post('/api/v1/auth/password/reset').send({ token, password });
const login = (email: string, password: string) =>
  http().post('/api/v1/auth/login').send({ email, password });
const refresh = (cookie: string) => http().post('/api/v1/auth/refresh').set('Cookie', cookie);

async function resetLink(email: string, count = 1) {
  return linkIn(await waitForEmailTo(email, { subject: RESET_SUBJECT, count }));
}

describe('forgot / reset password', () => {
  it('emails a reset link; resetting replaces the password and signs out every device', async () => {
    const user = await registerUser(app);
    const otherDevice = await loginUser(app, user.email);

    await forgot(user.email.toUpperCase()).expect(204);
    const { url, token } = await resetLink(user.email);
    expect(url).toBe(`${APP_ORIGIN}/reset-password#token=${token}`);

    await reset(token).expect(204);

    await login(user.email, TEST_PASSWORD).expect(401);
    await login(user.email, NEW_PASSWORD).expect(200);
    await refresh(user.refreshCookie).expect(401);
    await refresh(otherDevice.refreshCookie).expect(401);

    const notice = await waitForEmailTo(user.email, { subject: CHANGED_SUBJECT });
    expect(notice.Text).toContain(`${APP_ORIGIN}/forgot-password`);
  });

  it('marks the email verified, since the link proved the inbox', async () => {
    const user = await createUser(database.db, { passwordHash: null });
    await forgot(user.email).expect(204);
    await reset((await resetLink(user.email)).token).expect(204);

    const [stored] = await database.db.select().from(users).where(eq(users.id, user.id));
    expect(stored?.emailVerifiedAt).not.toBeNull();
    // An account that only had OAuth now has a password too.
    await login(user.email, NEW_PASSWORD).expect(200);
  });

  it('answers an unknown email exactly like a known one and sends nothing', async () => {
    const email = uniqueEmail();
    const res = await forgot(email).expect(204);
    expect(res.body).toEqual({});
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await countEmailsTo(email)).toBe(0);
  });

  it('a reset link works once', async () => {
    const user = await registerUser(app);
    await forgot(user.email).expect(204);
    const { token } = await resetLink(user.email);

    await reset(token).expect(204);
    const again = await reset(token, 'yet another password').expect(400);
    expect(again.body.error.code).toBe('INVALID_TOKEN');
    await login(user.email, NEW_PASSWORD).expect(200);
  });

  it('only the latest reset link works', async () => {
    const user = await registerUser(app);
    await forgot(user.email).expect(204);
    const first = await resetLink(user.email);
    await forgot(user.email).expect(204);
    const second = await resetLink(user.email, 2);

    await reset(first.token).expect(400);
    await reset(second.token).expect(204);
  });

  it('refuses an expired link', async () => {
    const user = await registerUser(app);
    await forgot(user.email).expect(204);
    const { token } = await resetLink(user.email);
    await database.db
      .update(userTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(userTokens.userId, user.body.user.id));

    await reset(token).expect(400);
    await login(user.email, TEST_PASSWORD).expect(200);
  });

  it('a verification link cannot be used to reset the password', async () => {
    const user = await registerUser(app);
    const { token } = linkIn(await waitForEmailTo(user.email, { subject: 'Verify your email' }));
    await reset(token).expect(400);
  });

  it('applies the password rules to the new password', async () => {
    const user = await registerUser(app);
    await forgot(user.email).expect(204);
    const { token } = await resetLink(user.email);

    const res = await reset(token, 'short').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    // A rejected request does not use up the link.
    await reset(token).expect(204);
  });
});

describe('change password', () => {
  const change = (authorization: string, currentPassword: string, newPassword = NEW_PASSWORD) =>
    http()
      .post('/api/v1/auth/password/change')
      .set('Authorization', authorization)
      .send({ currentPassword, newPassword });

  it('needs the current password, signs out the other devices and keeps this one signed in', async () => {
    const user = await registerUser(app);
    const otherDevice = await loginUser(app, user.email);

    const res = await change(bearer(user), TEST_PASSWORD)
      .set('Cookie', user.refreshCookie)
      .expect(200);
    const body = tokenResponseSchema.parse(res.body.data);
    const newSecret = cookieValue(setCookieLines(res), 'ff_refresh');

    expect(newSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await refresh(`ff_refresh=${newSecret}`).expect(200);
    await refresh(user.refreshCookie).expect(401);
    await refresh(otherDevice.refreshCookie).expect(401);
    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);

    await login(user.email, TEST_PASSWORD).expect(401);
    await login(user.email, NEW_PASSWORD).expect(200);
    await waitForEmailTo(user.email, { subject: CHANGED_SUBJECT });
  });

  it('refuses a wrong current password without signing anyone out', async () => {
    const user = await registerUser(app);
    const res = await change(bearer(user), 'not the password').expect(400);

    expect(res.body.error.code).toBe('INVALID_PASSWORD');
    await refresh(user.refreshCookie).expect(200);
    await login(user.email, TEST_PASSWORD).expect(200);
  });

  it('tells an account without a password to use the reset flow', async () => {
    const user = await registerUser(app);
    await database.db
      .update(users)
      .set({ passwordHash: null })
      .where(eq(users.id, user.body.user.id));

    const res = await change(bearer(user), TEST_PASSWORD).expect(409);
    expect(res.body.error.code).toBe('PASSWORD_NOT_SET');
  });

  it('applies the password rules and needs a signed-in user', async () => {
    const user = await registerUser(app);
    await change(bearer(user), TEST_PASSWORD, 'short').expect(400);
    await http()
      .post('/api/v1/auth/password/change')
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(401);
  });
});
