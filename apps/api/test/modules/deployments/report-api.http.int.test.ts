import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  apiTokenSchema,
  auditLogPageSchema,
  createdApiTokenSchema,
  deploymentPageSchema,
  deploymentSchema,
  type Project,
} from '@forgeflow/contracts';
import { apiTokens, createDatabase, deployments, type DatabaseHandle } from '@forgeflow/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../../src/app.factory.js';
import {
  bearer,
  client,
  envFor,
  randomIp,
  registerUser,
  type SignedIn,
} from '../../support/http.js';
import { addMember, createOrganization, verifiedUser } from '../../support/organizations.js';
import { testOwnerDatabaseUrl } from '../../support/test-database.js';

let database: DatabaseHandle;
let app: INestApplication;

beforeAll(async () => {
  database = createDatabase(testOwnerDatabaseUrl(), { max: 2 });
  app = await createApp(envFor());
  await app.init();
});

afterAll(async () => {
  await app.close();
  await database.close();
});

async function projectWithToken(name = 'Checkout') {
  const owner = await verifiedUser(app, database);
  const organization = await createOrganization(app, owner);
  const project = (
    await client(app)
      .post(`/api/v1/organizations/${organization.id}/projects`)
      .set('Authorization', bearer(owner))
      .send({ name })
      .expect(201)
  ).body.data as Project;
  const token = await createToken(organization.id, project.id, owner);
  return { owner, organization, project, token };
}

async function createToken(
  orgId: string,
  projectId: string,
  user: SignedIn,
  body = { name: 'CI' },
) {
  const res = await client(app)
    .post(`/api/v1/organizations/${orgId}/projects/${projectId}/api-tokens`)
    .set('Authorization', bearer(user))
    .send(body)
    .expect(201);
  expect(res.headers['cache-control']).toBe('no-store');
  return createdApiTokenSchema.parse(res.body.data);
}

/** The report API as a pipeline calls it: no Origin, a project token, an Idempotency-Key. */
function report(
  secret: string | null,
  body: Record<string, unknown>,
  key: string | null = randomUUID(),
) {
  const req = request(app.getHttpServer())
    .post('/api/v1/deployments')
    .set('X-Forwarded-For', randomIp());
  if (secret) req.set('Authorization', `Bearer ${secret}`);
  if (key) req.set('Idempotency-Key', key);
  return req.send(body);
}

function update(secret: string, deploymentId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .patch(`/api/v1/deployments/${deploymentId}`)
    .set('X-Forwarded-For', randomIp())
    .set('Authorization', `Bearer ${secret}`)
    .send(body);
}

describe('API tokens', () => {
  it('are shown once, listed by their prefix, and revoked by owners and admins', async () => {
    const { owner, organization, project, token } = await projectWithToken();
    expect(token.secret).toMatch(/^ffp_[A-Za-z0-9_-]{43}$/);
    expect(token.token).toMatchObject({
      name: 'CI',
      prefix: token.secret.slice(0, 8),
      scopes: ['deployments:write'],
      revokedAt: null,
      createdBy: { email: owner.email },
    });
    const url = `/api/v1/organizations/${organization.id}/projects/${project.id}/api-tokens`;
    const list = await client(app).get(url).set('Authorization', bearer(owner)).expect(200);
    expect(
      z
        .array(apiTokenSchema)
        .parse(list.body.data)
        .map((t) => t.id),
    ).toEqual([token.token.id]);
    expect(list.text).not.toContain(token.secret);
    const [stored] = await database.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.id, token.token.id));
    expect(stored!.tokenHash).not.toContain(token.secret.slice(4));

    const member = await registerUser(app);
    await addMember(database, organization.id, member, 'member');
    await client(app).get(url).set('Authorization', bearer(member)).expect(403);
    await client(app)
      .post(url)
      .set('Authorization', bearer(member))
      .send({ name: 'x' })
      .expect(403);

    await client(app)
      .delete(`${url}/${token.token.id}`)
      .set('Authorization', bearer(owner))
      .expect(204);
    await client(app)
      .delete(`${url}/${token.token.id}`)
      .set('Authorization', bearer(owner))
      .expect(404);
    await report(token.secret, { environment: 'production' }).expect(401);

    const trail = await client(app)
      .get(`/api/v1/organizations/${organization.id}/audit-logs`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(
      auditLogPageSchema
        .parse(trail.body.data)
        .entries.slice(0, 2)
        .map((e) => e.action),
    ).toEqual(['api_token.revoked', 'api_token.created']);
    expect(trail.text).not.toContain(token.secret);
  });

  it('stop working once expired', async () => {
    const { token } = await projectWithToken();
    await database.db
      .update(apiTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apiTokens.id, token.token.id));
    await report(token.secret, { environment: 'production' }).expect(401);
  });
});

describe('POST /api/v1/deployments', () => {
  it('needs a valid token of the project and an Idempotency-Key', async () => {
    const { token } = await projectWithToken();
    const body = { environment: 'production' };
    for (const secret of [
      null,
      'not-a-token',
      `ffp_${'A'.repeat(43)}`,
      token.secret.slice(0, -1),
    ]) {
      const res = await report(secret, body).expect(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
    }
    const missing = await report(token.secret, body, null).expect(400);
    expect(missing.body.error.message).toMatch(/Idempotency-Key/);
    await report(token.secret, body, 'has spaces').expect(400);
    await report(token.secret, { environment: '' }).expect(400);
    // Links end up in the dashboard's href: http(s) only.
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://ci.example.com/1']) {
      await report(token.secret, { ...body, url }).expect(400);
      await report(token.secret, { ...body, environmentUrl: url }).expect(400);
    }
  });

  it('records a deployment, and the same one again for a retried request (Idempotency-Key)', async () => {
    const { owner, organization, project, token } = await projectWithToken();
    const key = `deploy-${randomUUID()}`;
    const body = {
      environment: 'production',
      version: 'v2.0.0',
      sha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
      ref: 'main',
      status: 'in_progress',
      creator: 'gitlab-ci',
      url: 'https://ci.example.com/jobs/42',
    };
    const created = await report(token.secret, body, key).expect(201);
    const deployment = deploymentSchema.parse(created.body.data);
    expect(deployment).toMatchObject({
      source: 'api',
      kind: 'deployment',
      environment: { name: 'production' },
      version: 'v2.0.0',
      status: 'in_progress',
      creator: 'gitlab-ci',
    });

    // The pipeline retries (timeout, network): same deployment, 200.
    const again = await report(token.secret, { ...body }, key).expect(200);
    expect(again.body.data.id).toBe(deployment.id);
    // Five at once with a new key: one deployment.
    const burstKey = `burst-${randomUUID()}`;
    const burst = await Promise.all(
      Array.from({ length: 5 }, () => report(token.secret, { environment: 'staging' }, burstKey)),
    );
    expect(burst.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(burst.map((r) => r.body.data.id)).size).toBe(1);
    // The same key for something else is refused.
    const reused = await report(token.secret, { ...body, version: 'v2.0.1' }, key).expect(422);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const rows = await database.db
      .select()
      .from(deployments)
      .where(eq(deployments.projectId, project.id));
    expect(rows).toHaveLength(2);

    const list = await client(app)
      .get(`/api/v1/organizations/${organization.id}/projects/${project.id}/deployments`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(
      deploymentPageSchema
        .parse(list.body.data)
        .deployments.map((d) => d.environment?.name)
        .sort(),
    ).toEqual(['production', 'staging']);
  });

  it('adds the environment a pipeline names when the project lacks it', async () => {
    const { owner, organization, project, token } = await projectWithToken();
    await report(token.secret, { environment: 'canary', status: 'success' }).expect(201);
    const res = await client(app)
      .get(`/api/v1/organizations/${organization.id}/projects/${project.id}`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect((res.body.data as Project).environments.map((e) => e.name)).toContain('canary');
  });
});

describe('PATCH /api/v1/deployments/:deploymentId', () => {
  it("moves a reported deployment on, and only the token's project's", async () => {
    const { project, token } = await projectWithToken();
    const created = deploymentSchema.parse(
      (await report(token.secret, { environment: 'production', status: 'in_progress' }).expect(201))
        .body.data,
    );
    const done = await update(token.secret, created.id, {
      status: 'success',
      environmentUrl: 'https://checkout.example.com',
    }).expect(200);
    expect(deploymentSchema.parse(done.body.data)).toMatchObject({
      status: 'success',
      environmentUrl: 'https://checkout.example.com',
    });
    expect(done.body.data.finishedAt).not.toBeNull();
    expect(done.body.data.durationSeconds).toBeGreaterThanOrEqual(0);

    // Another project of the same organization, with its own token.
    const other = await projectWithToken('Other');
    await update(other.token.secret, created.id, { status: 'failure' }).expect(404);
    await update(token.secret, randomUUID(), { status: 'failure' }).expect(404);

    const [row] = await database.db
      .select()
      .from(deployments)
      .where(eq(deployments.projectId, project.id));
    expect(row!.status).toBe('success');
  });
});
