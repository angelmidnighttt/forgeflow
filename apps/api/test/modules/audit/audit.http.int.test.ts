import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  auditLogPageSchema,
  projectSchema,
  type AuditLogEntry,
  type AuditLogPage,
} from '@forgeflow/contracts';
import { auditLogs, createDatabase, type DatabaseHandle } from '@forgeflow/database';
import { eq } from 'drizzle-orm';
import { createApp } from '../../../src/app.factory.js';
import {
  bearer,
  client,
  envFor,
  randomIp,
  registerUser,
  uniqueEmail,
  type SignedIn,
} from '../../support/http.js';
import { linkIn, testSmtpUrl, waitForEmailTo } from '../../support/mailpit.js';
import { addMember, createOrganization, verifiedUser } from '../../support/organizations.js';
import { testOwnerDatabaseUrl } from '../../support/test-database.js';

let database: DatabaseHandle;
let app: INestApplication;

beforeAll(async () => {
  database = createDatabase(testOwnerDatabaseUrl(), { max: 2 });
  // Mailpit, so that invitations can be sent and accepted.
  app = await createApp(envFor({ SMTP_URL: testSmtpUrl() }));
  await app.init();
});

afterAll(async () => {
  await app.close();
  await database.close();
});

const orgUrl = (orgId: string) => `/api/v1/organizations/${orgId}`;

async function trail(
  orgId: string,
  user: SignedIn,
  query: { limit?: number; cursor?: string } = {},
): Promise<AuditLogPage> {
  const res = await client(app)
    .get(`${orgUrl(orgId)}/audit-logs`)
    .query(query)
    .set('Authorization', bearer(user))
    .expect(200);
  return auditLogPageSchema.parse(res.body.data);
}

/** Every entry of the organization, oldest first, following the cursors. */
async function wholeTrail(orgId: string, user: SignedIn, limit = 100): Promise<AuditLogEntry[]> {
  const entries: AuditLogEntry[] = [];
  let cursor: string | undefined;
  do {
    const page = await trail(orgId, user, { limit, ...(cursor ? { cursor } : {}) });
    entries.push(...page.entries);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return entries.reverse();
}

describe('the audit trail', () => {
  it('records every sensitive action, with who did it, to what, the details and the IP', async () => {
    const ip = randomIp();
    const as = (user: SignedIn) => ({ Authorization: bearer(user) });
    const owner = await verifiedUser(app, database, { name: 'Ann Owner' });
    const organization = await createOrganization(app, owner, 'Acme');
    const url = orgUrl(organization.id);

    await client(app, ip).patch(url).set(as(owner)).send({ name: 'Acme Corp' }).expect(200);

    // An invitation, accepted.
    const inviteeEmail = uniqueEmail();
    await client(app, ip)
      .post(`${url}/invitations`)
      .set(as(owner))
      .send({ email: inviteeEmail, role: 'member' })
      .expect(201);
    const { token } = linkIn(await waitForEmailTo(inviteeEmail, { subject: 'invited you' }));
    const invitee = await registerUser(app, { email: inviteeEmail, name: 'Ivy Invitee' });
    await client(app, ip)
      .post('/api/v1/invitations/accept')
      .set(as(invitee))
      .send({ token })
      .expect(200);
    const inviteeId = invitee.body.user.id;

    // Role changed, then the member leaves.
    await client(app, ip)
      .patch(`${url}/members/${inviteeId}`)
      .set(as(owner))
      .send({ role: 'admin' })
      .expect(200);
    await client(app, ip).delete(`${url}/members/${inviteeId}`).set(as(invitee)).expect(204);

    // Someone removed, an invitation revoked.
    const removed = await registerUser(app, { name: 'Rob Removed' });
    await addMember(database, organization.id, removed, 'viewer');
    await client(app, ip)
      .delete(`${url}/members/${removed.body.user.id}`)
      .set(as(owner))
      .expect(204);
    const revokedEmail = uniqueEmail();
    const invitation = await client(app, ip)
      .post(`${url}/invitations`)
      .set(as(owner))
      .send({ email: revokedEmail, role: 'viewer' })
      .expect(201);
    await client(app, ip)
      .delete(`${url}/invitations/${invitation.body.data.id}`)
      .set(as(owner))
      .expect(204);

    // A project and its environments.
    const created = await client(app, ip)
      .post(`${url}/projects`)
      .set(as(owner))
      .send({ name: 'Checkout' })
      .expect(201);
    const project = projectSchema.parse(created.body.data);
    const projectUrl = `${url}/projects/${project.id}`;
    await client(app, ip).patch(projectUrl).set(as(owner)).send({ name: 'Payments' }).expect(200);
    const preview = await client(app, ip)
      .post(`${projectUrl}/environments`)
      .set(as(owner))
      .send({ name: 'preview' })
      .expect(201);
    const staging = project.environments[1]!;
    await client(app, ip)
      .patch(`${projectUrl}/environments/${staging.id}`)
      .set(as(owner))
      .send({ name: 'uat', protected: true })
      .expect(200);
    const production = project.environments[2]!;
    await client(app, ip)
      .patch(`${projectUrl}/environments/${production.id}`)
      .set(as(owner))
      .send({ protected: false })
      .expect(200);

    const entries = await wholeTrail(organization.id, owner);
    const ownerId = owner.body.user.id;
    expect(entries.map((e) => [e.action, e.actor.id === ownerId ? 'owner' : 'invitee'])).toEqual([
      ['organization.created', 'owner'],
      ['organization.renamed', 'owner'],
      ['invitation.created', 'owner'],
      ['invitation.accepted', 'invitee'],
      ['member.role_changed', 'owner'],
      ['member.left', 'invitee'],
      ['member.removed', 'owner'],
      ['invitation.created', 'owner'],
      ['invitation.revoked', 'owner'],
      ['project.created', 'owner'],
      ['project.renamed', 'owner'],
      ['environment.created', 'owner'],
      ['environment.renamed', 'owner'],
      ['environment.protected', 'owner'],
      ['environment.unprotected', 'owner'],
    ]);
    const byAction = (action: string) => entries.filter((e) => e.action === action);

    expect(entries[0]!.actor).toEqual({
      type: 'user',
      id: ownerId,
      name: 'Ann Owner',
      email: owner.email,
    });
    expect(byAction('organization.renamed')[0]).toMatchObject({
      target: { type: 'organization', id: organization.id },
      metadata: { from: 'Acme', to: 'Acme Corp' },
      ipAddress: ip,
    });
    expect(byAction('invitation.accepted')[0]).toMatchObject({
      metadata: { email: inviteeEmail, role: 'member', alreadyMember: false },
    });
    expect(byAction('member.role_changed')[0]).toMatchObject({
      target: { type: 'user', id: inviteeId },
      metadata: { email: inviteeEmail, name: 'Ivy Invitee', from: 'member', to: 'admin' },
    });
    expect(byAction('member.left')[0]!.metadata).toMatchObject({ role: 'admin' });
    expect(byAction('member.removed')[0]!.metadata).toMatchObject({
      name: 'Rob Removed',
      role: 'viewer',
    });
    expect(byAction('invitation.revoked')[0]).toMatchObject({
      target: { type: 'invitation', id: invitation.body.data.id },
      metadata: { email: revokedEmail, role: 'viewer' },
    });
    expect(byAction('project.renamed')[0]!.metadata).toEqual({ from: 'Checkout', to: 'Payments' });
    expect(byAction('environment.created')[0]).toMatchObject({
      target: { type: 'environment', id: preview.body.data.id },
      metadata: { project: 'Payments', name: 'preview', protected: false },
    });
    expect(byAction('environment.renamed')[0]!.metadata).toEqual({
      project: 'Payments',
      from: 'staging',
      to: 'uat',
    });
    expect(byAction('environment.protected')[0]!.metadata).toEqual({
      project: 'Payments',
      name: 'uat',
    });
    expect(byAction('environment.unprotected')[0]!.target).toEqual({
      type: 'environment',
      id: production.id,
    });
    // Never a secret: the invitation token appears nowhere.
    expect(JSON.stringify(entries)).not.toContain(token);
  });

  it('keeps the request id, to find the log lines of an entry', async () => {
    const owner = await verifiedUser(app, database);
    const organization = await createOrganization(app, owner);
    await client(app)
      .patch(orgUrl(organization.id))
      .set('Authorization', bearer(owner))
      .set('X-Request-Id', 'audit-test-request-1')
      .send({ name: 'Renamed' })
      .expect(200);

    const rows = await database.db
      .select({ action: auditLogs.action, requestId: auditLogs.requestId })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, organization.id));
    expect(rows).toContainEqual({
      action: 'organization.renamed',
      requestId: 'audit-test-request-1',
    });
  });

  it('records nothing when nothing changed or the action was refused', async () => {
    const owner = await verifiedUser(app, database);
    const organization = await createOrganization(app, owner, 'Same');
    const url = orgUrl(organization.id);
    const as = { Authorization: bearer(owner) };
    const ownerId = owner.body.user.id;

    // Unchanged: same name, same role.
    await client(app).patch(url).set(as).send({ name: 'Same' }).expect(200);
    await client(app)
      .patch(`${url}/members/${ownerId}`)
      .set(as)
      .send({ role: 'owner' })
      .expect(200);
    // Refused: the last owner cannot step down or leave; a project name is taken.
    await client(app)
      .patch(`${url}/members/${ownerId}`)
      .set(as)
      .send({ role: 'admin' })
      .expect(409);
    await client(app).delete(`${url}/members/${ownerId}`).set(as).expect(409);
    await client(app).post(`${url}/projects`).set(as).send({ name: 'Taken' }).expect(201);
    await client(app).post(`${url}/projects`).set(as).send({ name: 'taken' }).expect(409);

    const entries = await wholeTrail(organization.id, owner);
    expect(entries.map((e) => e.action)).toEqual(['organization.created', 'project.created']);
  });

  it('commits an entry together with its action, or neither', async () => {
    const owner = await verifiedUser(app, database);
    const organization = await createOrganization(app, owner, 'Before');
    // Make writing this organization's audit entries fail, as a broken audit write would.
    const fn = `test_fail_audit_${randomUUID().replaceAll('-', '')}`;
    await database.pool.query(`
      CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.organization_id = '${organization.id}' THEN
          RAISE EXCEPTION 'audit write failed (test)';
        END IF;
        RETURN NEW;
      END $$`);
    await database.pool.query(
      `CREATE TRIGGER ${fn} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    try {
      const url = orgUrl(organization.id);
      const as = { Authorization: bearer(owner) };
      await client(app).patch(url).set(as).send({ name: 'After' }).expect(500);
      await client(app).post(`${url}/projects`).set(as).send({ name: 'Lost' }).expect(500);

      // Neither change happened.
      const org = await client(app).get(url).set(as).expect(200);
      expect(org.body.data.name).toBe('Before');
      const projects = await client(app).get(`${url}/projects`).set(as).expect(200);
      expect(projects.body.data).toEqual([]);
    } finally {
      await database.pool.query(`DROP TRIGGER ${fn} ON audit_logs`);
      await database.pool.query(`DROP FUNCTION ${fn}()`);
    }
  });
});

describe('GET /organizations/:orgId/audit-logs', () => {
  it('pages newest first, without gaps or repeats', async () => {
    const owner = await verifiedUser(app, database);
    const organization = await createOrganization(app, owner, 'Name 0');
    for (let i = 1; i <= 6; i++) {
      await client(app)
        .patch(orgUrl(organization.id))
        .set('Authorization', bearer(owner))
        .send({ name: `Name ${i}` })
        .expect(200);
    }

    const first = await trail(organization.id, owner, { limit: 3 });
    expect(first.entries.map((e) => e.metadata.to)).toEqual(['Name 6', 'Name 5', 'Name 4']);
    expect(first.nextCursor).not.toBeNull();

    const all = await wholeTrail(organization.id, owner, 2);
    expect(all.map((e) => e.action)).toEqual([
      'organization.created',
      ...Array<string>(6).fill('organization.renamed'),
    ]);
    expect(new Set(all.map((e) => e.id)).size).toBe(7);

    const last = await trail(organization.id, owner, { limit: 7 });
    expect(last.nextCursor).toBeNull();
  });

  it('refuses a bad limit or cursor', async () => {
    const owner = await verifiedUser(app, database);
    const organization = await createOrganization(app, owner);
    for (const query of [{ limit: '0' }, { limit: '101' }, { limit: 'many' }]) {
      await client(app)
        .get(`${orgUrl(organization.id)}/audit-logs`)
        .query(query)
        .set('Authorization', bearer(owner))
        .expect(400);
    }
    const res = await client(app)
      .get(`${orgUrl(organization.id)}/audit-logs`)
      .query({ cursor: 'bm90IGEgY3Vyc29y' })
      .set('Authorization', bearer(owner))
      .expect(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('is for owners and admins of the organization only', async () => {
    const owner = await verifiedUser(app, database);
    const organization = await createOrganization(app, owner);
    const people: Record<string, SignedIn> = {};
    for (const role of ['admin', 'member', 'viewer'] as const) {
      people[role] = await registerUser(app);
      await addMember(database, organization.id, people[role], role);
    }
    const outsider = await verifiedUser(app, database);
    const own = await createOrganization(app, outsider, 'Elsewhere');
    const get = (user: SignedIn, orgId = organization.id) =>
      client(app)
        .get(`${orgUrl(orgId)}/audit-logs`)
        .set('Authorization', bearer(user));

    await get(people.admin!).expect(200);
    for (const role of ['member', 'viewer']) {
      const res = await get(people[role]!).expect(403);
      expect(res.body.error.code).toBe('ROLE_NOT_ALLOWED');
    }
    await get(outsider).expect(404);

    // Each organization sees only its own trail.
    const elsewhere = await trail(own.id, outsider);
    expect(elsewhere.entries.map((e) => e.metadata.name)).toEqual(['Elsewhere']);
  });
});
