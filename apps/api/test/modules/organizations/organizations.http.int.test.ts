import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { organizationSchema } from '@forgeflow/contracts';
import { createDatabase, type DatabaseHandle } from '@forgeflow/database';
import { z } from 'zod';
import { createApp } from '../../../src/app.factory.js';
import { bearer, client, envFor, registerUser } from '../../support/http.js';
import { addMember, createOrganization, verifiedUser } from '../../support/organizations.js';
import { testDatabaseUrl } from '../../support/test-database.js';

let database: DatabaseHandle;
let app: INestApplication;

beforeAll(async () => {
  database = createDatabase(testDatabaseUrl(), { max: 2 });
  app = await createApp(envFor());
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
