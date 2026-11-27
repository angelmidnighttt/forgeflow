import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  auditLogPageSchema,
  githubAppSchema,
  githubInstallLinkSchema,
  repositorySchema,
} from '@forgeflow/contracts';
import {
  createDatabase,
  integrations,
  memberships,
  outboxEvents,
  type DatabaseHandle,
} from '@forgeflow/database';
import { and, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from '../../../src/app.factory.js';
import { bearer, client, envFor, registerUser, type SignedIn } from '../../support/http.js';
import { FakeGithubApp } from '../../support/fake-github-app.js';
import { githubAppEnv, GITHUB_APP_SLUG } from '../../support/github-app.js';
import { uniqueNumber } from '../../support/github-fixtures.js';
import { addMember, createOrganization, verifiedUser } from '../../support/organizations.js';
import { testOwnerDatabaseUrl } from '../../support/test-database.js';

let database: DatabaseHandle;
let app: INestApplication;
let github: FakeGithubApp;

beforeAll(async () => {
  database = createDatabase(testOwnerDatabaseUrl(), { max: 2 });
  github = await new FakeGithubApp().start();
  app = await createApp(envFor(githubAppEnv(github.url)));
  await app.init();
});

afterAll(async () => {
  await app.close();
  await github.stop();
  await database.close();
});

const repo = (id: number, fullName: string) => ({
  id,
  full_name: fullName,
  html_url: `https://github.com/${fullName}`,
  default_branch: 'main',
  private: true,
});

/** Starts the installation in ForgeFlow: the GitHub link (with state) and the browser cookie. */
async function startInstall(orgId: string, user: SignedIn) {
  const res = await client(app)
    .post(`/api/v1/organizations/${orgId}/integrations/github/install`)
    .set('Authorization', bearer(user))
    .expect(201);
  const { url } = githubInstallLinkSchema.parse(res.body.data);
  const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
    c.startsWith('ff_github='),
  );
  return {
    url: new URL(url),
    state: new URL(url).searchParams.get('state') ?? '',
    cookie: cookie?.split(';')[0] ?? '',
  };
}

/** GitHub sends the browser back to the setup URL. */
function setup(query: Record<string, string>, cookie?: string) {
  const req = client(app).get(`/api/v1/github/setup?${new URLSearchParams(query).toString()}`);
  if (cookie) req.set('Cookie', cookie);
  return req.expect(302);
}

function redirectOf(res: { headers: Record<string, unknown> }): URL {
  return new URL(String(res.headers.location));
}

async function connected(
  installationId: number,
  login = `acct-${installationId}`,
  repos = [repo(uniqueNumber(), `${login}/api`), repo(uniqueNumber(), `${login}/web`)],
) {
  const owner = await verifiedUser(app, database);
  const organization = await createOrganization(app, owner);
  github.addInstallation(installationId, login, repos);
  const { state, cookie } = await startInstall(organization.id, owner);
  const code = github.authorize([installationId]);
  const res = await setup(
    { installation_id: String(installationId), setup_action: 'install', code, state },
    cookie,
  );
  return { owner, organization, res, repos };
}

describe('GET /api/v1/github/app', () => {
  it('tells whether the server has a GitHub App', async () => {
    const user = await registerUser(app);
    const res = await client(app)
      .get('/api/v1/github/app')
      .set('Authorization', bearer(user))
      .expect(200);
    expect(githubAppSchema.parse(res.body.data)).toEqual({
      configured: true,
      slug: GITHUB_APP_SLUG,
    });
  });
});

describe('connecting an installation', () => {
  it('links the installation the user owns, with its repositories, and says so', async () => {
    const installationId = uniqueNumber();
    const { owner, organization, res, repos } = await connected(installationId);

    const back = redirectOf(res);
    expect(back.pathname).toBe(`/orgs/${organization.id}/integrations`);
    expect(back.searchParams.get('github')).toBe('connected');
    // The state cookie is cleared.
    expect(String(res.headers['set-cookie'])).toMatch(/ff_github=;/);

    const [integration] = await database.db
      .select()
      .from(integrations)
      .where(eq(integrations.externalId, String(installationId)));
    expect(integration).toMatchObject({
      organizationId: organization.id,
      kind: 'github',
      status: 'active',
      name: `GitHub acct-${installationId}`,
      config: expect.objectContaining({ account: `acct-${installationId}` }),
    });

    const list = await client(app)
      .get(`/api/v1/organizations/${organization.id}/integrations/${integration!.id}/repositories`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(
      z
        .array(repositorySchema)
        .parse(list.body.data)
        .map((r) => r.fullName)
        .sort(),
    ).toEqual(repos.map((r) => r.full_name).sort());

    const trail = await client(app)
      .get(`/api/v1/organizations/${organization.id}/audit-logs`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(auditLogPageSchema.parse(trail.body.data).entries[0]).toMatchObject({
      action: 'integration.created',
      actor: { id: owner.body.user.id },
      metadata: { kind: 'github' },
    });
  });

  it('sends the user to GitHub with a signed state and sets the browser cookie', async () => {
    const owner = await verifiedUser(app, database);
    const organization = await createOrganization(app, owner);
    const { url, state, cookie } = await startInstall(organization.id, owner);
    expect(`${url.origin}${url.pathname}`).toBe(
      `${github.url}/apps/${GITHUB_APP_SLUG}/installations/new`,
    );
    expect(state.split('.')).toHaveLength(3);
    expect(cookie).toMatch(/^ff_github=[A-Za-z0-9_-]{43}$/);
  });

  it('refuses a return without the right state, cookie, authorization or installation', async () => {
    const installationId = uniqueNumber();
    github.addInstallation(installationId, `acct-${installationId}`);
    const owner = await verifiedUser(app, database);
    const organization = await createOrganization(app, owner);
    const errorOf = (res: { headers: Record<string, unknown> }) =>
      redirectOf(res).searchParams.get('github_error');
    const id = String(installationId);

    const first = await startInstall(organization.id, owner);
    // No cookie (another browser), the wrong cookie, a forged state.
    expect(
      errorOf(
        await setup({
          installation_id: id,
          code: github.authorize([installationId]),
          state: first.state,
        }),
      ),
    ).toBe('state');
    expect(
      errorOf(
        await setup(
          { installation_id: id, code: github.authorize([installationId]), state: first.state },
          'ff_github=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        ),
      ),
    ).toBe('state');
    expect(
      errorOf(
        await setup(
          {
            installation_id: id,
            code: github.authorize([installationId]),
            state: `${first.state}x`,
          },
          first.cookie,
        ),
      ),
    ).toBe('state');

    // No authorization code (the App does not ask for user authorization on install).
    const second = await startInstall(organization.id, owner);
    expect(errorOf(await setup({ installation_id: id, state: second.state }, second.cookie))).toBe(
      'authorization',
    );

    // The user cannot access that installation (someone else's id).
    const third = await startInstall(organization.id, owner);
    const other = uniqueNumber();
    github.addInstallation(other, `acct-${other}`);
    expect(
      errorOf(
        await setup(
          {
            installation_id: String(other),
            code: github.authorize([installationId]),
            state: third.state,
          },
          third.cookie,
        ),
      ),
    ).toBe('not_yours');

    // Asking an owner of the account to install it.
    const fourth = await startInstall(organization.id, owner);
    const requested = redirectOf(
      await setup({ setup_action: 'request', state: fourth.state }, fourth.cookie),
    );
    expect(requested.searchParams.get('github')).toBe('requested');

    expect(
      await database.db.select().from(integrations).where(eq(integrations.externalId, id)),
    ).toEqual([]);
  });

  it('refuses an installation already connected to another organization', async () => {
    const installationId = uniqueNumber();
    await connected(installationId);
    const intruder = await verifiedUser(app, database);
    const theirs = await createOrganization(app, intruder);
    const { state, cookie } = await startInstall(theirs.id, intruder);
    // Even a user GitHub vouches for cannot move it.
    const res = await setup(
      { installation_id: String(installationId), code: github.authorize([installationId]), state },
      cookie,
    );
    expect(redirectOf(res).searchParams.get('github_error')).toBe('taken');
  });

  it('refuses a user who can no longer manage the integrations by the time they return', async () => {
    const installationId = uniqueNumber();
    github.addInstallation(installationId, `acct-${installationId}`);
    const owner = await verifiedUser(app, database);
    const organization = await createOrganization(app, owner);
    const admin = await registerUser(app);
    await addMember(database, organization.id, admin, 'admin');
    const { state, cookie } = await startInstall(organization.id, admin);
    await database.db
      .update(memberships)
      .set({ role: 'member' })
      .where(
        and(
          eq(memberships.organizationId, organization.id),
          eq(memberships.userId, admin.body.user.id),
        ),
      );
    const res = await setup(
      { installation_id: String(installationId), code: github.authorize([installationId]), state },
      cookie,
    );
    expect(redirectOf(res).searchParams.get('github_error')).toBe('forbidden');
  });

  it('is for owners and admins of the organization', async () => {
    const owner = await verifiedUser(app, database);
    const organization = await createOrganization(app, owner);
    const member = await registerUser(app);
    await addMember(database, organization.id, member, 'member');
    await client(app)
      .post(`/api/v1/organizations/${organization.id}/integrations/github/install`)
      .set('Authorization', bearer(member))
      .expect(403);
  });

  it('reconnects a reinstalled account to the same integration', async () => {
    const first = uniqueNumber();
    const login = `acct-${first}`;
    const { owner, organization } = await connected(first, login);
    const [before] = await database.db
      .select()
      .from(integrations)
      .where(eq(integrations.externalId, String(first)));

    // Uninstalled on GitHub, then installed again: a new installation id.
    await database.db
      .update(integrations)
      .set({ status: 'disabled' })
      .where(eq(integrations.id, before!.id));
    const second = uniqueNumber();
    github.addInstallation(second, login, [repo(uniqueNumber(), `${login}/api`)]);
    const { state, cookie } = await startInstall(organization.id, owner);
    await setup(
      { installation_id: String(second), code: github.authorize([second]), state },
      cookie,
    );
    const [after] = await database.db
      .select()
      .from(integrations)
      .where(eq(integrations.id, before!.id));
    expect(after).toMatchObject({ externalId: String(second), status: 'active' });
  });
});

describe('repositories', () => {
  it('map to a project of the organization, by owners and admins', async () => {
    const installationId = uniqueNumber();
    const { owner, organization } = await connected(installationId);
    const [integration] = await database.db
      .select()
      .from(integrations)
      .where(eq(integrations.externalId, String(installationId)));
    const project = await client(app)
      .post(`/api/v1/organizations/${organization.id}/projects`)
      .set('Authorization', bearer(owner))
      .send({ name: 'Checkout' })
      .expect(201);
    const list = await client(app)
      .get(`/api/v1/organizations/${organization.id}/integrations/${integration!.id}/repositories`)
      .set('Authorization', bearer(owner))
      .expect(200);
    const [first] = z.array(repositorySchema).parse(list.body.data);
    const url = `/api/v1/organizations/${organization.id}/repositories/${first!.id}`;

    const catchUps = (since: Date) =>
      database.db
        .select({ status: outboxEvents.status })
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.topic, 'github.reconcile'),
            sql`${outboxEvents.payload} ->> 'integrationId' = ${integration!.id}`,
            gte(outboxEvents.createdAt, since),
          ),
        );
    const before = new Date(Date.now() - 1000);
    const mapped = await client(app)
      .patch(url)
      .set('Authorization', bearer(owner))
      .send({ projectId: project.body.data.id })
      .expect(200);
    expect(repositorySchema.parse(mapped.body.data).projectId).toBe(project.body.data.id);
    // Its history is fetched now (the catch-up job is queued), not at the next scheduled run;
    // mapping again does not pile up another waiting job.
    expect((await catchUps(before)).length).toBeGreaterThanOrEqual(1);
    await client(app)
      .patch(url)
      .set('Authorization', bearer(owner))
      .send({ projectId: project.body.data.id })
      .expect(200);
    expect(
      (await catchUps(before)).filter((e) => e.status === 'pending').length,
    ).toBeLessThanOrEqual(1);

    const member = await registerUser(app);
    await addMember(database, organization.id, member, 'member');
    await client(app)
      .patch(url)
      .set('Authorization', bearer(member))
      .send({ projectId: null })
      .expect(403);

    // Another organization's project cannot be the target.
    const stranger = await verifiedUser(app, database);
    const strangers = await createOrganization(app, stranger);
    const theirProject = await client(app)
      .post(`/api/v1/organizations/${strangers.id}/projects`)
      .set('Authorization', bearer(stranger))
      .send({ name: 'Theirs' })
      .expect(201);
    await client(app)
      .patch(url)
      .set('Authorization', bearer(owner))
      .send({ projectId: theirProject.body.data.id })
      .expect(404);
    // Nor can another organization reach this repository.
    await client(app)
      .patch(`/api/v1/organizations/${strangers.id}/repositories/${first!.id}`)
      .set('Authorization', bearer(stranger))
      .send({ projectId: theirProject.body.data.id })
      .expect(404);

    const trail = await client(app)
      .get(`/api/v1/organizations/${organization.id}/audit-logs`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(auditLogPageSchema.parse(trail.body.data).entries[0]).toMatchObject({
      action: 'repository.mapped',
      metadata: { repository: first!.fullName, project: 'Checkout' },
    });
  });
});
