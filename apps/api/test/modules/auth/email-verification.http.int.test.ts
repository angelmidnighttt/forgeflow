import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { authUserSchema } from '@forgeflow/contracts';
import { createDatabase, users, userTokens, type DatabaseHandle } from '@forgeflow/database';
import { eq } from 'drizzle-orm';
import { createApp } from '../../../src/app.factory.js';
import {
  APP_ORIGIN,
  bearer,
  envFor,
  registerUser,
  type SignedIn,
  client,
} from '../../support/http.js';
import { linkIn, testSmtpUrl, waitForEmailTo } from '../../support/mailpit.js';
import { testOwnerDatabaseUrl } from '../../support/test-database.js';

const SUBJECT = 'Verify your email';

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

async function me(user: SignedIn) {
  const res = await http().get('/api/v1/auth/me').set('Authorization', bearer(user)).expect(200);
  return authUserSchema.parse(res.body.data);
}

const verify = (token: string) => http().post('/api/v1/auth/verify-email').send({ token });

describe('email verification', () => {
  it('signing up emails a one-time link that verifies the address', async () => {
    const user = await registerUser(app);
    const email = await waitForEmailTo(user.email, { subject: SUBJECT });
    const { url, token } = linkIn(email);

    expect(email.Subject).toBe('Verify your email for ForgeFlow');
    expect(url).toBe(`${APP_ORIGIN}/verify-email#token=${token}`);
    expect(email.HTML).toContain(`href="${url}"`);
    expect((await me(user)).emailVerified).toBe(false);

    await verify(token).expect(204);
    expect((await me(user)).emailVerified).toBe(true);

    const reused = await verify(token).expect(400);
    expect(reused.body.error.code).toBe('INVALID_TOKEN');
  });

  it('escapes the name in the HTML version of the email', async () => {
    const user = await registerUser(app, { name: '<img src=x onerror=alert(1)>' });
    const email = await waitForEmailTo(user.email, { subject: SUBJECT });
    expect(email.HTML).toContain('Hi &lt;img src=x onerror=alert(1)&gt;,');
    expect(email.HTML).not.toContain('<img');
    expect(email.Text).toContain('Hi <img src=x onerror=alert(1)>,');
  });

  it('refuses an expired link', async () => {
    const user = await registerUser(app);
    const { token } = linkIn(await waitForEmailTo(user.email, { subject: SUBJECT }));
    await database.db
      .update(userTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(userTokens.userId, user.body.user.id));

    expect((await verify(token).expect(400)).body.error.code).toBe('INVALID_TOKEN');
    expect((await me(user)).emailVerified).toBe(false);
  });

  it('refuses a link sent to an address the account no longer has', async () => {
    const user = await registerUser(app);
    const { token } = linkIn(await waitForEmailTo(user.email, { subject: SUBJECT }));
    await database.db
      .update(users)
      .set({ email: `changed-${user.email}` })
      .where(eq(users.id, user.body.user.id));

    await verify(token).expect(400);
  });

  it('refuses unknown and malformed tokens', async () => {
    await verify('A'.repeat(43)).expect(400);
    await verify('not-a-token').expect(400);
    const empty = await verify('').expect(400);
    expect(empty.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('resending makes a new link and the earlier one stops working', async () => {
    const user = await registerUser(app);
    const first = linkIn(await waitForEmailTo(user.email, { subject: SUBJECT }));

    await http()
      .post('/api/v1/auth/verify-email/resend')
      .set('Authorization', bearer(user))
      .expect(204);
    const second = linkIn(await waitForEmailTo(user.email, { subject: SUBJECT, count: 2 }));

    expect(second.token).not.toBe(first.token);
    await verify(first.token).expect(400);
    await verify(second.token).expect(204);
  });

  it('does not resend once the email is verified', async () => {
    const user = await registerUser(app);
    await verify(linkIn(await waitForEmailTo(user.email, { subject: SUBJECT })).token).expect(204);

    const res = await http()
      .post('/api/v1/auth/verify-email/resend')
      .set('Authorization', bearer(user))
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_VERIFIED');
  });

  it('resending needs a signed-in user', async () => {
    await http().post('/api/v1/auth/verify-email/resend').expect(401);
  });
});

describe('email verification with the SMTP server down', () => {
  // envFor() points SMTP at a port where nothing listens.
  let downApp: INestApplication;

  beforeAll(async () => {
    downApp = await createApp(envFor());
    await downApp.init();
  });

  afterAll(async () => {
    await downApp.close();
  });

  it('still creates the account, and resending reports that the email could not be sent', async () => {
    const user = await registerUser(downApp);
    expect(user.body.user.emailVerified).toBe(false);

    const res = await client(downApp)
      .post('/api/v1/auth/verify-email/resend')
      .set('Authorization', bearer(user))
      .expect(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
