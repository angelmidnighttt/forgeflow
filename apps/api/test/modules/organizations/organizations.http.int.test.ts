import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { organizationSchema } from '@forgeflow/contracts';
import { createDatabase, invitations, type DatabaseHandle } from '@forgeflow/database';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from '../../../src/app.factory.js';
import { bearer, client, envFor, registerUser } from '../../support/http.js';
import { addMember, createOrganization, verifiedUser } from '../../support/organizations.js';
import { testSmtpUrl } from '../../support/mailpit.js';
import { testOwnerDatabaseUrl } from '../../support/test-database.js';

let database: DatabaseHandle;
let app: INestApplication;

beforeAll(async () => {
  database = createDatabase(testOwnerDatabaseUrl(), { max: 2 });
  // Mailpit, so that invitations in the isolation tests can be sent.
  app = await createApp(envFor({ SMTP_URL: testSmtpUrl() }));
  await app.init();
});

afterAll(async () => {
  await app.close();
  await database.close();
});

describe('POST /api/v1/organizations', () => {
  it('creates an organization with the caller as owner', async () => {
    const user = await verifiedUser(app, database);
    const res = await client(app)
      .post('/api/v1/organizations')
      .set('Authorization', bearer(user))
      .send({ name: '  Công ty Acme ' })
      .expect(201);

    expect(organizationSchema.parse(res.body.data)).toMatchObject({
      name: 'Công ty Acme',
      role: 'owner',
    });
  });

  it('needs a verified email', async () => {
    const user = await registerUser(app);
    const res = await client(app)
      .post('/api/v1/organizations')
      .set('Authorization', bearer(user))
      .send({ name: 'Acme' })
      .expect(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('validates the name and needs a signed-in user', async () => {
    const user = await verifiedUser(app, database);
    const res = await client(app)
      .post('/api/v1/organizations')
      .set('Authorization', bearer(user))
      .send({ name: '   ' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    await client(app).post('/api/v1/organizations').send({ name: 'Acme' }).expect(401);
  });
});

describe('GET /api/v1/organizations', () => {
  it("lists the caller's organizations with their role in each, and nobody else's", async () => {
    const ann = await verifiedUser(app, database);
    const bob = await verifiedUser(app, database);
    const own = await createOrganization(app, ann, 'Beta');
    const joined = await createOrganization(app, bob, 'Alpha');
    await addMember(database, joined.id, ann, 'viewer');
    await createOrganization(app, bob, 'Not shared');

    const res = await client(app)
      .get('/api/v1/organizations')
      .set('Authorization', bearer(ann))
      .expect(200);
    const list = z.array(organizationSchema).parse(res.body.data);
    expect(list.map((o) => [o.name, o.role])).toEqual([
      ['Alpha', 'viewer'],
      ['Beta', 'owner'],
    ]);
    expect(list.map((o) => o.id)).toEqual([joined.id, own.id]);
  });
});

describe('GET /api/v1/organizations/:orgId', () => {
  it('shows the organization to its members, with their own role', async () => {
    const owner = await verifiedUser(app, database);
    const viewer = await registerUser(app);
    const organization = await createOrganization(app, owner);
    await addMember(database, organization.id, viewer, 'viewer');

    const res = await client(app)
      .get(`/api/v1/organizations/${organization.id}`)
      .set('Authorization', bearer(viewer))
      .expect(200);
    expect(res.body.data).toMatchObject({ id: organization.id, role: 'viewer' });
  });

  it('answers 404 alike for outsiders, unknown ids and malformed ids', async () => {
    const owner = await verifiedUser(app, database);
    const outsider = await registerUser(app);
    const organization = await createOrganization(app, owner);

    for (const id of [organization.id, randomUUID(), 'not-a-uuid']) {
      const res = await client(app)
        .get(`/api/v1/organizations/${id}`)
        .set('Authorization', bearer(outsider))
        .expect(404);
      expect(res.body.error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Organization not found.',
      });
    }
    await client(app).get(`/api/v1/organizations/${organization.id}`).expect(401);
  });
});

describe('PATCH /api/v1/organizations/:orgId', () => {
  it('lets owners and admins rename it, and refuses members and viewers', async () => {
    const owner = await verifiedUser(app, database);
    const organization = await createOrganization(app, owner, 'Old name');
    const people = {
      admin: await registerUser(app),
      member: await registerUser(app),
      viewer: await registerUser(app),
    };
    for (const [role, user] of Object.entries(people)) {
      await addMember(database, organization.id, user, role as 'admin' | 'member' | 'viewer');
    }
    const rename = (user: typeof owner, name: string) =>
      client(app)
        .patch(`/api/v1/organizations/${organization.id}`)
        .set('Authorization', bearer(user))
        .send({ name });

    await rename(owner, 'By owner').expect(200);
    const byAdmin = await rename(people.admin, 'By admin').expect(200);
    expect(byAdmin.body.data).toMatchObject({ name: 'By admin', role: 'admin' });
    for (const user of [people.member, people.viewer]) {
      const res = await rename(user, 'Nope').expect(403);
      expect(res.body.error.code).toBe('ROLE_NOT_ALLOWED');
    }
  });
});

describe('isolation between organizations (required test #5)', () => {
  it("gives a member of A no way to read or change B's data through the API", async () => {
    const alice = await verifiedUser(app, database);
    const bob = await verifiedUser(app, database);
    await createOrganization(app, alice, 'A');
    const b = await createOrganization(app, bob, 'B');
    const victim = await registerUser(app);
    await addMember(database, b.id, victim, 'member');
    const invited = await client(app)
      .post(`/api/v1/organizations/${b.id}/invitations`)
      .set('Authorization', bearer(bob))
      .send({ email: `${randomUUID()}@example.test`, role: 'member' });
    expect(invited.status).toBe(201);
    const invitationId = (invited.body.data as { id: string }).id;

    const base = `/api/v1/organizations/${b.id}`;
    const member = `${base}/members/${victim.body.user.id}`;
    const attempts = [
      client(app).get(base),
      client(app).patch(base).send({ name: 'Hijacked' }),
      client(app).get(`${base}/members`),
      client(app).patch(member).send({ role: 'viewer' }),
      client(app).delete(member),
      client(app).get(`${base}/invitations`),
      client(app).post(`${base}/invitations`).send({ email: 'x@example.test', role: 'member' }),
      client(app).delete(`${base}/invitations/${invitationId}`),
    ];
    for (const attempt of attempts) {
      const res = await attempt.set('Authorization', bearer(alice));
      expect([res.status, res.body.error?.code]).toEqual([404, 'NOT_FOUND']);
    }

    const stillThere = await client(app)
      .get(`${base}/members`)
      .set('Authorization', bearer(bob))
      .expect(200);
    expect(stillThere.body.data).toHaveLength(2);
  });

  it('ignores an organizationId in the body: the organization is always the one in the URL', async () => {
    const owner = await verifiedUser(app, database);
    const a = await createOrganization(app, owner, 'A');
    const b = await createOrganization(app, owner, 'B');
    const email = `${randomUUID()}@example.test`;

    await client(app)
      .post(`/api/v1/organizations/${a.id}/invitations`)
      .set('Authorization', bearer(owner))
      .send({ email, role: 'member', organizationId: b.id })
      .expect(201);

    const rows = await database.db.select().from(invitations).where(eq(invitations.email, email));
    expect(rows.map((row) => row.organizationId)).toEqual([a.id]);
  });
});
