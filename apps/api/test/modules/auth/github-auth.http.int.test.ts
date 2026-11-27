import { randomInt } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { authProvidersSchema, authUserSchema, tokenResponseSchema } from '@forgeflow/contracts';
import { createDatabase, oauthAccounts, users, type DatabaseHandle } from '@forgeflow/database';
import { eq } from 'drizzle-orm';
import { createApp } from '../../../src/app.factory.js';
import {
  FAKE_GITHUB_CLIENT_ID,
  FAKE_GITHUB_CLIENT_SECRET,
  FakeGithub,
  type FakeGithubAccount,
} from '../../support/fake-github.js';
import {
  APP_ORIGIN,
  client,
  cookieLine,
  cookieValue,
  envFor,
  registerUser,
  setCookieLines,
  TEST_PASSWORD,
  uniqueEmail,
} from '../../support/http.js';
import { testOwnerDatabaseUrl } from '../../support/test-database.js';

let database: DatabaseHandle;
let github: FakeGithub;
let app: INestApplication;

beforeAll(async () => {
  database = createDatabase(testOwnerDatabaseUrl(), { max: 2 });
  github = await new FakeGithub().start();
  app = await createApp(
    envFor({
      GITHUB_CLIENT_ID: FAKE_GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: FAKE_GITHUB_CLIENT_SECRET,
      GITHUB_URL: github.url,
      GITHUB_API_URL: github.url,
    }),
  );
  await app.init();
});

afterAll(async () => {
  await app.close();
  await github.stop();
  await database.close();
});

function githubAccount(overrides: Partial<FakeGithubAccount> = {}): FakeGithubAccount {
  const id = randomInt(1, 2 ** 31);
  return {
    id,
    login: `octo-${id}`,
    name: 'Octo Cat',
    emails: [{ email: uniqueEmail(), primary: true, verified: true }],
    ...overrides,
  };
}

const primaryEmail = (account: FakeGithubAccount) => account.emails[0]?.email ?? '';

/** Starts the sign-in: the redirect to GitHub and the state cookie it set. */
async function start() {
  const res = await client(app).get('/api/v1/auth/github').expect(302);
  const lines = setCookieLines(res);
  return {
    authorizeUrl: res.headers.location as string,
    stateCookieLine: cookieLine(lines, 'ff_oauth') ?? '',
    stateCookie: `ff_oauth=${cookieValue(lines, 'ff_oauth')}`,
  };
}

/** The whole round trip: start, approve on (fake) GitHub, come back to the callback. */
async function signInWithGithub(account: FakeGithubAccount, extraCookie?: string) {
  const { authorizeUrl, stateCookie } = await start();
  const { code, state } = github.approve(authorizeUrl, account);
  const res = await client(app)
    .get(`/api/v1/auth/github/callback?code=${code}&state=${state}`)
    .set('Cookie', [stateCookie, ...(extraCookie ? [extraCookie] : [])].join('; '))
    .expect(302);
  const refreshSecret = cookieValue(setCookieLines(res), 'ff_refresh');
  return {
    location: res.headers.location as string,
    lines: setCookieLines(res),
    refreshCookie: refreshSecret ? `ff_refresh=${refreshSecret}` : undefined,
  };
}

/** Uses the refresh cookie like the web app does after the redirect: who is signed in? */
async function signedInUser(refreshCookie: string | undefined) {
  if (!refreshCookie) throw new Error('no refresh cookie was set');
  const res = await client(app)
    .post('/api/v1/auth/refresh')
    .set('Cookie', refreshCookie)
    .expect(200);
  return tokenResponseSchema.parse(res.body.data).user;
}

async function storedUser(email: string) {
  const [user] = await database.db.select().from(users).where(eq(users.email, email));
  return user;
}

describe('GET /api/v1/auth/providers', () => {
  it('tells the login page that GitHub sign-in is on', async () => {
    const res = await client(app).get('/api/v1/auth/providers').expect(200);
    expect(authProvidersSchema.parse(res.body.data)).toEqual({ github: true });
  });
});

describe('GET /api/v1/auth/github', () => {
  it('redirects to GitHub with the client id, callback, scopes, state and a PKCE challenge', async () => {
    const { authorizeUrl, stateCookieLine } = await start();
    const url = new URL(authorizeUrl);

    expect(`${url.origin}${url.pathname}`).toBe(`${github.url}/login/oauth/authorize`);
    expect(url.searchParams.get('client_id')).toBe(FAKE_GITHUB_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(`${APP_ORIGIN}/api/v1/auth/github/callback`);
    expect(url.searchParams.get('scope')).toBe('read:user user:email');
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    expect(stateCookieLine).toMatch(/; HttpOnly/i);
    expect(stateCookieLine).toMatch(/; SameSite=Lax/i);
    expect(stateCookieLine).toMatch(/; Path=\/api\/v1\/auth\/github(;|$)/);
    expect(stateCookieLine).toMatch(/; Max-Age=600/);
    // The cookie holds the state sent to GitHub, never the PKCE challenge.
    expect(stateCookieLine).toContain(url.searchParams.get('state'));
    expect(stateCookieLine).not.toContain(url.searchParams.get('code_challenge'));
  });
});

describe('GET /api/v1/auth/github/callback', () => {
  it('creates a verified account without a password for a new GitHub user', async () => {
    const account = githubAccount({ name: 'Mona Lisa' });
    const result = await signInWithGithub(account);

    expect(result.location).toBe(`${APP_ORIGIN}/`);
    expect(cookieLine(result.lines, 'ff_oauth')).toMatch(/Expires=Thu, 01 Jan 1970/);
    const user = authUserSchema.parse(await signedInUser(result.refreshCookie));
    expect(user).toMatchObject({
      email: primaryEmail(account),
      name: 'Mona Lisa',
      emailVerified: true,
    });

    const stored = await storedUser(primaryEmail(account));
    expect(stored?.passwordHash).toBeNull();
    const [link] = await database.db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, user.id));
    expect(link).toMatchObject({
      provider: 'github',
      providerAccountId: String(account.id),
      providerLogin: account.login,
    });
  });

  it('signs the same GitHub account into the same user, and follows a username change', async () => {
    const account = githubAccount({ name: null });
    const first = await signedInUser((await signInWithGithub(account)).refreshCookie);
    expect(first.name).toBe(account.login);

    const renamed = { ...account, login: `${account.login}-renamed` };
    const second = await signedInUser((await signInWithGithub(renamed)).refreshCookie);
    expect(second.id).toBe(first.id);

    const [link] = await database.db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.providerAccountId, String(account.id)));
    expect(link?.providerLogin).toBe(renamed.login);
  });

  it('links GitHub to an existing verified account with that email, keeping its password', async () => {
    const existing = await registerUser(app);
    await database.db
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(users.id, existing.body.user.id));

    const account = githubAccount({
      emails: [{ email: existing.email, primary: true, verified: true }],
    });
    const user = await signedInUser((await signInWithGithub(account)).refreshCookie);

    expect(user.id).toBe(existing.body.user.id);
    await client(app)
      .post('/api/v1/auth/login')
      .send({ email: existing.email, password: TEST_PASSWORD })
      .expect(200);
    await client(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', existing.refreshCookie)
      .expect(200);
  });

  it('takes over an unverified account with that email, dropping its password and sign-ins', async () => {
    // Someone signed up with this address without owning it (account pre-hijacking).
    const squatter = await registerUser(app);
    const account = githubAccount({
      emails: [{ email: squatter.email, primary: true, verified: true }],
    });
    const user = await signedInUser((await signInWithGithub(account)).refreshCookie);

    expect(user.id).toBe(squatter.body.user.id);
    expect(user.emailVerified).toBe(true);
    await client(app)
      .post('/api/v1/auth/login')
      .send({ email: squatter.email, password: TEST_PASSWORD })
      .expect(401);
    await client(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', squatter.refreshCookie)
      .expect(401);
  });

  it('refuses a second GitHub account for a user who already linked one', async () => {
    const first = githubAccount();
    await signInWithGithub(first);
    const second = githubAccount({ emails: first.emails });

    const result = await signInWithGithub(second);
    expect(result.location).toBe(`${APP_ORIGIN}/login?error=github_account_conflict`);
    expect(result.refreshCookie).toBeUndefined();
  });

  it('refuses a GitHub account without a verified primary email', async () => {
    const email = uniqueEmail();
    const account = githubAccount({
      emails: [
        { email, primary: true, verified: false },
        { email: uniqueEmail(), primary: false, verified: true },
      ],
    });
    const result = await signInWithGithub(account);

    expect(result.location).toBe(`${APP_ORIGIN}/login?error=github_email_unverified`);
    expect(result.refreshCookie).toBeUndefined();
    expect(await storedUser(email)).toBeUndefined();
  });

  it('refuses a callback whose state does not match the cookie, or without the cookie', async () => {
    const { authorizeUrl, stateCookie } = await start();
    const { code } = github.approve(authorizeUrl, githubAccount());

    const wrongState = await client(app)
      .get(`/api/v1/auth/github/callback?code=${code}&state=${'x'.repeat(43)}`)
      .set('Cookie', stateCookie)
      .expect(302);
    expect(wrongState.headers.location).toBe(`${APP_ORIGIN}/login?error=oauth_state`);

    const state = new URL(authorizeUrl).searchParams.get('state');
    const noCookie = await client(app)
      .get(`/api/v1/auth/github/callback?code=${code}&state=${state}`)
      .expect(302);
    expect(noCookie.headers.location).toBe(`${APP_ORIGIN}/login?error=oauth_state`);
    expect(cookieValue(setCookieLines(noCookie), 'ff_refresh')).toBeUndefined();
  });

  it('reports a cancelled consent and a code GitHub refuses', async () => {
    const { stateCookie, authorizeUrl } = await start();
    const state = new URL(authorizeUrl).searchParams.get('state');
    const denied = await client(app)
      .get(`/api/v1/auth/github/callback?error=access_denied&state=${state}`)
      .set('Cookie', stateCookie)
      .expect(302);
    expect(denied.headers.location).toBe(`${APP_ORIGIN}/login?error=oauth_denied`);

    const again = await start();
    const againState = new URL(again.authorizeUrl).searchParams.get('state');
    const badCode = await client(app)
      .get(`/api/v1/auth/github/callback?code=not-a-real-code&state=${againState}`)
      .set('Cookie', again.stateCookie)
      .expect(302);
    expect(badCode.headers.location).toBe(`${APP_ORIGIN}/login?error=oauth_failed`);
  });

  it('ends the sign-in this browser held before', async () => {
    const before = await registerUser(app);
    const result = await signInWithGithub(githubAccount(), before.refreshCookie);

    expect(result.location).toBe(`${APP_ORIGIN}/`);
    await client(app).post('/api/v1/auth/refresh').set('Cookie', before.refreshCookie).expect(401);
  });
});

describe('without GitHub configured', () => {
  it('answers 404 on both routes and reports GitHub as off', async () => {
    const plain = await createApp(envFor());
    await plain.init();
    try {
      await client(plain).get('/api/v1/auth/github').expect(404);
      await client(plain).get('/api/v1/auth/github/callback?code=x&state=y').expect(404);
      const providers = await client(plain).get('/api/v1/auth/providers').expect(200);
      expect(providers.body.data).toEqual({ github: false });
    } finally {
      await plain.close();
    }
  });
});
