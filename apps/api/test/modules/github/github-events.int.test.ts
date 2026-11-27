import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { auditLogPageSchema, deploymentPageSchema, type Project } from '@forgeflow/contracts';
import {
  createDatabase,
  deploymentEvents,
  deployments,
  environments,
  integrations,
  outboxEvents,
  repositories,
  webhookDeliveries,
  type DatabaseHandle,
} from '@forgeflow/database';
import { and, eq, sql } from 'drizzle-orm';
import { createApp } from '../../../src/app.factory.js';
import type { OutboxHandler } from '../../../src/common/types/outbox.types.js';
import { GithubReconcileService } from '../../../src/modules/github/github-reconcile.service.js';
import { GithubWebhooksService } from '../../../src/modules/github/github-webhooks.service.js';
import { IntegrationsService } from '../../../src/modules/integrations/integrations.service.js';
import { OutboxProcessor } from '../../../src/modules/outbox/outbox-worker.service.js';
import { OutboxService } from '../../../src/modules/outbox/outbox.service.js';
import { bearer, client, envFor, registerUser } from '../../support/http.js';
import { FakeGithubApp } from '../../support/fake-github-app.js';
import { githubAppEnv, sendGithubWebhook } from '../../support/github-app.js';
import {
  githubFixture,
  uniqueNumber,
  type GithubFixtureName,
} from '../../support/github-fixtures.js';
import { addMember, createOrganization, verifiedUser } from '../../support/organizations.js';
import { testOwnerDatabaseUrl } from '../../support/test-database.js';

let database: DatabaseHandle;
let app: INestApplication;
let github: FakeGithubApp;
let worker: OutboxProcessor;

beforeAll(async () => {
  database = createDatabase(testOwnerDatabaseUrl(), { max: 3 });
  github = await new FakeGithubApp().start();
  app = await createApp(envFor(githubAppEnv(github.url)));
  await app.init();
  const webhooks = app.get(GithubWebhooksService);
  const reconcile = app.get(GithubReconcileService);
  const handlers = new Map<string, OutboxHandler>([
    ['github.webhook', (event) => webhooks.handle(event)],
    ['github.reconcile', (event) => reconcile.handle(event)],
  ]);
  worker = new OutboxProcessor(
    app.get(OutboxService),
    handlers,
    { batchSize: 10, leaseSeconds: 30, maxAttempts: 5, maxHoldSeconds: 600 },
    { warn: () => undefined, error: () => undefined },
  );
});

afterAll(async () => {
  await app.close();
  await github.stop();
  await database.close();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs the worker until `done` holds (another test file's worker may take events too). */
async function until(done: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await worker.runOnce();
    if (await done()) return;
    if (Date.now() > deadline) throw new Error('timed out waiting for the worker');
    await sleep(50);
  }
}

/** Sends a webhook as GitHub would and waits until the worker has handled it. */
async function deliver(event: string, body: Record<string, unknown>): Promise<string> {
  const res = await sendGithubWebhook(app, { event, body }).expect(202);
  const [delivery] = await database.db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, res.body.data.id as string));
  let status = '';
  await until(async () => {
    const [row] = await database.db
      .select({ status: outboxEvents.status })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, delivery!.outboxEventId!));
    status = row?.status ?? '';
    return status === 'done' || status === 'dead';
  });
  return status;
}

/** An organization with a connected installation and one repository mapped to a project. */
async function connectedProject() {
  const owner = await verifiedUser(app, database);
  const organization = await createOrganization(app, owner);
  const created = await client(app)
    .post(`/api/v1/organizations/${organization.id}/projects`)
    .set('Authorization', bearer(owner))
    .send({ name: 'Checkout' })
    .expect(201);
  const project = created.body.data as Project;
  const installationId = uniqueNumber();
  const { integration } = await app
    .get(IntegrationsService)
    .create(
      organization.id,
      { kind: 'github', name: `GitHub ${installationId}`, externalId: String(installationId) },
      'system',
    );
  const repositoryId = uniqueNumber();
  const fullName = `acme-${repositoryId}/checkout`;
  await database.db.insert(repositories).values({
    organizationId: organization.id,
    integrationId: integration.id,
    projectId: project.id,
    externalId: String(repositoryId),
    fullName,
    htmlUrl: `https://github.com/${fullName}`,
  });
  github.addInstallation(installationId, `acme-${repositoryId}`, [
    { id: repositoryId, full_name: fullName, private: true },
  ]);
  const ids = { installationId, repositoryId, fullName };
  const payload = (
    name: GithubFixtureName,
    extra: Parameters<typeof githubFixture>[1] = {},
    edit?: Parameters<typeof githubFixture>[2],
  ) => githubFixture(name, { ...ids, ...extra }, edit);
  return { owner, organization, project, integration, ids, payload };
}

async function deploymentsOf(projectId: string) {
  return database.db.select().from(deployments).where(eq(deployments.projectId, projectId));
}

describe('deployment webhooks', () => {
  it('records a deployment and its status, once however often an event comes', async () => {
    const { project, payload } = await connectedProject();
    const deploymentId = uniqueNumber();
    expect(await deliver('deployment', payload('deployment.created', { deploymentId }))).toBe(
      'done',
    );
    let [row] = await deploymentsOf(project.id);
    expect(row).toMatchObject({
      source: 'github',
      kind: 'deployment',
      externalId: String(deploymentId),
      environmentName: 'staging',
      ref: 'main',
      version: 'main',
      status: 'queued',
      creator: 'octo-org',
    });
    const [staging] = await database.db
      .select()
      .from(environments)
      .where(and(eq(environments.projectId, project.id), eq(environments.name, 'staging')));
    expect(row!.environmentId).toBe(staging!.id);

    const statusId = uniqueNumber();
    const status = payload('deployment_status.created', { deploymentId, statusId });
    // The same status, delivered twice (two delivery ids: the event itself, not a redelivery).
    expect(await deliver('deployment_status', status)).toBe('done');
    expect(await deliver('deployment_status', status)).toBe('done');
    [row] = await deploymentsOf(project.id);
    expect(row).toMatchObject({
      status: 'success',
      url: 'https://github.com/octo-org/forgeflow/actions/runs/45968056076/job/140402916568',
      environmentUrl: 'https://staging.example.com',
    });
    expect(row!.finishedAt?.toISOString()).toBe('2026-11-27T08:48:57.000Z');
    const events = await database.db
      .select()
      .from(deploymentEvents)
      .where(eq(deploymentEvents.deploymentId, row!.id));
    expect(events.map((e) => [e.status, e.externalId])).toEqual([['success', String(statusId)]]);
  });

  it('keeps the newest status when an older one arrives late', async () => {
    const { project, payload } = await connectedProject();
    const deploymentId = uniqueNumber();
    const success = payload('deployment_status.created', {
      deploymentId,
      statusId: uniqueNumber(),
    });
    const inProgress = payload(
      'deployment_status.created',
      { deploymentId, statusId: uniqueNumber() },
      (p) => {
        const s = p.deployment_status as Record<string, unknown>;
        s.state = 'in_progress';
        s.created_at = '2026-11-20T08:01:00Z';
      },
    );
    // The status arrives before the deployment event: the deployment comes from it.
    await deliver('deployment_status', success);
    await deliver('deployment_status', inProgress);
    const [row] = await deploymentsOf(project.id);
    expect(row!.status).toBe('success');
    expect(
      await database.db
        .select()
        .from(deploymentEvents)
        .where(eq(deploymentEvents.deploymentId, row!.id)),
    ).toHaveLength(2);
  });

  it('adds an environment a deployment names that the project lacks', async () => {
    const { owner, organization, project, payload } = await connectedProject();
    await deliver(
      'deployment',
      payload('deployment.created', { deploymentId: uniqueNumber() }, (p) => {
        (p.deployment as Record<string, unknown>).environment = 'Preview-EU';
      }),
    );
    const names = await database.db
      .select({ name: environments.name })
      .from(environments)
      .where(eq(environments.projectId, project.id));
    expect(names.map((n) => n.name)).toContain('Preview-EU');
    const trail = await client(app)
      .get(`/api/v1/organizations/${organization.id}/audit-logs`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(auditLogPageSchema.parse(trail.body.data).entries[0]).toMatchObject({
      action: 'environment.created',
      actor: { type: 'system' },
      metadata: { name: 'Preview-EU', reason: 'deployment' },
    });
  });

  it('records a GitHub Actions run with its result and duration', async () => {
    const { owner, project, payload } = await connectedProject();
    const runId = uniqueNumber();
    await deliver('workflow_run', payload('workflow_run.completed', { runId }));
    const [row] = await deploymentsOf(project.id);
    expect(row).toMatchObject({
      kind: 'workflow_run',
      environmentId: null,
      workflow: 'CI',
      version: '#21',
      status: 'success',
      creator: 'octo-org',
      url: 'https://github.com/octo-org/forgeflow/actions/runs/45971931004',
    });
    const res = await client(app)
      .get(`/api/v1/organizations/${row!.organizationId}/projects/${project.id}/deployments`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(deploymentPageSchema.parse(res.body.data).deployments[0]!.durationSeconds).toBe(101);
  });

  it('ignores repositories mapped to no project, and installations no organization connected', async () => {
    const { project, payload, integration } = await connectedProject();
    await database.db
      .update(repositories)
      .set({ projectId: null })
      .where(eq(repositories.integrationId, integration.id));
    expect(
      await deliver('deployment', payload('deployment.created', { deploymentId: uniqueNumber() })),
    ).toBe('done');
    expect(
      await deliver(
        'deployment',
        payload('deployment.created', {
          deploymentId: uniqueNumber(),
          installationId: uniqueNumber(),
        }),
      ),
    ).toBe('done');
    expect(await deploymentsOf(project.id)).toEqual([]);
  });
});

describe('installation webhooks', () => {
  it('disables the integration when the App is uninstalled (and records why)', async () => {
    const { owner, organization, integration, payload } = await connectedProject();
    expect(await deliver('installation', payload('installation.deleted'))).toBe('done');
    const [row] = await database.db
      .select()
      .from(integrations)
      .where(eq(integrations.id, integration.id));
    expect(row!.status).toBe('disabled');
    const trail = await client(app)
      .get(`/api/v1/organizations/${organization.id}/audit-logs`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(auditLogPageSchema.parse(trail.body.data).entries[0]).toMatchObject({
      action: 'integration.disabled',
      actor: { type: 'system' },
      metadata: { reason: 'uninstalled' },
    });
  });

  it('adds and removes repositories as the installation gains and loses them', async () => {
    const { integration, payload, ids, organization } = await connectedProject();
    const removedId = uniqueNumber();
    await database.db.insert(repositories).values({
      organizationId: organization.id,
      integrationId: integration.id,
      externalId: String(removedId),
      fullName: 'acme/legacy',
      htmlUrl: 'https://github.com/acme/legacy',
    });
    const addedId = uniqueNumber();
    await deliver(
      'installation_repositories',
      payload('installation_repositories.added', {}, (p) => {
        (p.repositories_added as Array<Record<string, unknown>>)[0]!.id = addedId;
        (p.repositories_removed as Array<Record<string, unknown>>)[0]!.id = removedId;
      }),
    );
    const rows = await database.db
      .select({ externalId: repositories.externalId, htmlUrl: repositories.htmlUrl })
      .from(repositories)
      .where(eq(repositories.integrationId, integration.id));
    expect(rows.map((r) => r.externalId).sort()).toEqual(
      [String(ids.repositoryId), String(addedId)].sort(),
    );
    expect(rows.find((r) => r.externalId === String(addedId))!.htmlUrl).toMatch(/acme\/billing$/);
  });
});

describe('the catch-up job', () => {
  it('records what webhooks missed, and nothing twice', async () => {
    const { project, integration, ids, organization } = await connectedProject();
    const deploymentId = uniqueNumber();
    github.deployments.set(ids.fullName, [
      {
        deployment: {
          id: deploymentId,
          sha: 'abcdef1234567890abcdef1234567890abcdef12',
          ref: 'main',
          environment: 'staging',
          creator: { login: 'octo' },
          created_at: '2026-11-21T10:00:00Z',
        },
        statuses: [
          { id: uniqueNumber(), state: 'in_progress', created_at: '2026-11-21T10:00:10Z' },
          { id: uniqueNumber(), state: 'failure', created_at: '2026-11-21T10:02:10Z' },
        ],
      },
    ]);
    github.runs.set(ids.fullName, [
      {
        id: uniqueNumber(),
        name: 'CI',
        head_branch: 'main',
        head_sha: 'abcdef1234567890abcdef1234567890abcdef12',
        status: 'in_progress',
        html_url: 'https://github.com/acme/checkout/actions/runs/9',
        run_number: 9,
        created_at: '2026-11-21T09:58:00Z',
        updated_at: '2026-11-21T09:59:00Z',
      },
    ]);

    const reconcile = app.get(GithubReconcileService);
    const event = {
      id: 'unused',
      organizationId: organization.id,
      topic: 'github.reconcile',
      payload: { integrationId: integration.id, installationId: String(ids.installationId) },
      attempts: 1,
      lockToken: 'unused',
    };
    await reconcile.handle(event);
    await reconcile.handle(event);

    const rows = await deploymentsOf(project.id);
    expect(rows.map((r) => [r.kind, r.status, r.ref]).sort()).toEqual([
      ['deployment', 'failure', 'main'],
      ['workflow_run', 'in_progress', 'main'],
    ]);
    const failed = rows.find((r) => r.kind === 'deployment')!;
    expect(
      await database.db
        .select()
        .from(deploymentEvents)
        .where(eq(deploymentEvents.deploymentId, failed.id)),
    ).toHaveLength(2);
    expect(failed.startedAt?.toISOString()).toBe('2026-11-21T10:00:10.000Z');
    // The second run knows the deployment finished: it does not ask GitHub for its statuses
    // again (the job stays cheap on the installation's rate limit).
    expect(
      github.requests.filter((request) =>
        request.includes(`/deployments/${deploymentId}/statuses`),
      ),
    ).toHaveLength(1);
  });

  it('is scheduled once per active GitHub integration, without piling up', async () => {
    const { integration } = await connectedProject();
    const reconcile = app.get(GithubReconcileService);
    await reconcile.schedule();
    await reconcile.schedule();
    const queued = await database.db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.topic, 'github.reconcile'),
          sql`${outboxEvents.payload}->>'integrationId' = ${integration.id}`,
        ),
      );
    expect(queued.length).toBeGreaterThanOrEqual(1);
    expect(
      queued.filter((e) => e.status === 'pending' || e.status === 'processing').length,
    ).toBeLessThanOrEqual(1);
  });
});

describe('GET /organizations/:orgId/projects/:projectId/deployments', () => {
  it('lists newest first, with filters and pages, to every member', async () => {
    const { organization, project, payload } = await connectedProject();
    for (let i = 0; i < 3; i++) {
      await deliver(
        'deployment',
        payload('deployment.created', { deploymentId: uniqueNumber() }, (p) => {
          const d = p.deployment as Record<string, unknown>;
          d.environment = i === 0 ? 'staging' : 'production';
          d.created_at = `2026-11-2${i + 1}T08:00:00Z`;
        }),
      );
    }
    await deliver('workflow_run', payload('workflow_run.completed', { runId: uniqueNumber() }));
    const viewer = await registerUser(app);
    await addMember(database, organization.id, viewer, 'viewer');
    const url = `/api/v1/organizations/${organization.id}/projects/${project.id}/deployments`;
    const get = async (query: Record<string, string>) =>
      deploymentPageSchema.parse(
        (await client(app).get(url).query(query).set('Authorization', bearer(viewer)).expect(200))
          .body.data,
      );

    const all = await get({});
    expect(all.deployments.map((d) => d.createdAt.slice(0, 10))).toEqual([
      '2026-11-27', // the Actions run
      '2026-11-23',
      '2026-11-22',
      '2026-11-21',
    ]);
    expect((await get({ kind: 'workflow_run' })).deployments).toHaveLength(1);
    const staging = all.deployments.find((d) => d.environment?.name === 'staging')!;
    expect(
      (await get({ environmentId: staging.environment!.id })).deployments.map((d) => d.id),
    ).toEqual([staging.id]);
    expect((await get({ status: 'success' })).deployments).toHaveLength(1);

    const first = await get({ limit: '2' });
    const second = await get({ limit: '2', cursor: first.nextCursor! });
    expect([...first.deployments, ...second.deployments].map((d) => d.id)).toEqual(
      all.deployments.map((d) => d.id),
    );
    expect(second.nextCursor).toBeNull();
  });

  it("never shows another organization's deployments (required test #5)", async () => {
    const a = await connectedProject();
    const b = await connectedProject();
    await deliver('deployment', b.payload('deployment.created', { deploymentId: uniqueNumber() }));
    await client(app)
      .get(`/api/v1/organizations/${b.organization.id}/projects/${b.project.id}/deployments`)
      .set('Authorization', bearer(a.owner))
      .expect(404);
    const mixed = await client(app)
      .get(`/api/v1/organizations/${a.organization.id}/projects/${b.project.id}/deployments`)
      .set('Authorization', bearer(a.owner))
      .expect(200);
    expect(mixed.body.data.deployments).toEqual([]);
  });
});
