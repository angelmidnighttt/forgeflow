import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  environmentSchema,
  projectSchema,
  type Environment,
  type OrganizationRole,
  type Project,
} from '@forgeflow/contracts';
import { createDatabase, type DatabaseHandle } from '@forgeflow/database';
import { z } from 'zod';
import { createApp } from '../../../src/app.factory.js';
import { bearer, client, envFor, registerUser, type SignedIn } from '../../support/http.js';
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

/** An organization with an owner, and a member of each other role. */
async function team() {
  const owner = await verifiedUser(app, database);
  const organization = await createOrganization(app, owner);
  const people = { owner } as Record<OrganizationRole, SignedIn>;
  for (const role of ['admin', 'member', 'viewer'] as const) {
    people[role] = await registerUser(app);
    await addMember(database, organization.id, people[role], role);
  }
  return { organization, ...people };
}

const projectsUrl = (orgId: string) => `/api/v1/organizations/${orgId}/projects`;

async function createProject(orgId: string, user: SignedIn, name = 'Checkout'): Promise<Project> {
  const res = await client(app)
    .post(projectsUrl(orgId))
    .set('Authorization', bearer(user))
    .send({ name })
    .expect(201);
  return projectSchema.parse(res.body.data);
}

async function addEnvironment(
  orgId: string,
  projectId: string,
  user: SignedIn,
  body: { name: string; protected?: boolean },
): Promise<Environment> {
  const res = await client(app)
    .post(`${projectsUrl(orgId)}/${projectId}/environments`)
    .set('Authorization', bearer(user))
    .send(body)
    .expect(201);
  return environmentSchema.parse(res.body.data);
}

describe('POST /organizations/:orgId/projects', () => {
  it('creates the project with development, staging and a protected production', async () => {
    const { organization, owner } = await team();
    const res = await client(app)
      .post(projectsUrl(organization.id))
      .set('Authorization', bearer(owner))
      .send({ name: '  Cổng thanh toán ' })
      .expect(201);

    const project = projectSchema.parse(res.body.data);
    expect(project.name).toBe('Cổng thanh toán');
    expect(project.environments.map((e) => [e.name, e.protected])).toEqual([
      ['development', false],
      ['staging', false],
      ['production', true],
    ]);
  });

  it('is for owners and admins only', async () => {
    const { organization, admin, member, viewer } = await team();
    await createProject(organization.id, admin, 'By admin');
    for (const user of [member, viewer]) {
      const res = await client(app)
        .post(projectsUrl(organization.id))
        .set('Authorization', bearer(user))
        .send({ name: 'Not allowed' })
        .expect(403);
      expect(res.body.error.code).toBe('ROLE_NOT_ALLOWED');
    }
  });

  it('validates the name', async () => {
    const { organization, owner } = await team();
    for (const name of ['   ', 'x'.repeat(101)]) {
      const res = await client(app)
        .post(projectsUrl(organization.id))
        .set('Authorization', bearer(owner))
        .send({ name })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('refuses a name another project of the organization has, ignoring case', async () => {
    const { organization, owner } = await team();
    await createProject(organization.id, owner, 'Checkout');
    const res = await client(app)
      .post(projectsUrl(organization.id))
      .set('Authorization', bearer(owner))
      .send({ name: 'CHECKOUT' })
      .expect(409);
    expect(res.body.error).toMatchObject({ code: 'NAME_TAKEN', details: { field: 'name' } });

    // Another organization may use it.
    const other = await team();
    await createProject(other.organization.id, other.owner, 'Checkout');
  });
});

describe('GET /organizations/:orgId/projects', () => {
  it('lists the projects by name, with their environments, to every member', async () => {
    const { organization, owner, viewer } = await team();
    await createProject(organization.id, owner, 'zeta');
    await createProject(organization.id, owner, 'Alpha');
    await createProject(organization.id, owner, 'beta');

    const res = await client(app)
      .get(projectsUrl(organization.id))
      .set('Authorization', bearer(viewer))
      .expect(200);
    const list = z.array(projectSchema).parse(res.body.data);
    expect(list.map((p) => p.name)).toEqual(['Alpha', 'beta', 'zeta']);
    expect(list.every((p) => p.environments.length === 3)).toBe(true);
  });

  it('is empty for an organization without projects', async () => {
    const { organization, member } = await team();
    const res = await client(app)
      .get(projectsUrl(organization.id))
      .set('Authorization', bearer(member))
      .expect(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /organizations/:orgId/projects/:projectId', () => {
  it('shows one project', async () => {
    const { organization, owner, member } = await team();
    const project = await createProject(organization.id, owner);
    const res = await client(app)
      .get(`${projectsUrl(organization.id)}/${project.id}`)
      .set('Authorization', bearer(member))
      .expect(200);
    expect(projectSchema.parse(res.body.data)).toEqual(project);
  });

  it('answers 404 for an unknown project and 400 for a malformed id', async () => {
    const { organization, owner } = await team();
    const res = await client(app)
      .get(`${projectsUrl(organization.id)}/${randomUUID()}`)
      .set('Authorization', bearer(owner))
      .expect(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Project not found.' });
    await client(app)
      .get(`${projectsUrl(organization.id)}/not-a-uuid`)
      .set('Authorization', bearer(owner))
      .expect(400);
  });
});

describe('PATCH /organizations/:orgId/projects/:projectId', () => {
  it('renames the project, keeping its environments', async () => {
    const { organization, admin } = await team();
    const project = await createProject(organization.id, admin, 'Old name');
    const res = await client(app)
      .patch(`${projectsUrl(organization.id)}/${project.id}`)
      .set('Authorization', bearer(admin))
      .send({ name: 'New name' })
      .expect(200);
    expect(projectSchema.parse(res.body.data)).toEqual({ ...project, name: 'New name' });
  });

  it("refuses another project's name, members, and unknown projects", async () => {
    const { organization, owner, member } = await team();
    await createProject(organization.id, owner, 'Taken');
    const project = await createProject(organization.id, owner, 'Mine');
    const url = `${projectsUrl(organization.id)}/${project.id}`;

    const taken = await client(app)
      .patch(url)
      .set('Authorization', bearer(owner))
      .send({ name: 'taken' })
      .expect(409);
    expect(taken.body.error.code).toBe('NAME_TAKEN');
    // Changing only the case of its own name is fine.
    await client(app)
      .patch(url)
      .set('Authorization', bearer(owner))
      .send({ name: 'MINE' })
      .expect(200);

    await client(app)
      .patch(url)
      .set('Authorization', bearer(member))
      .send({ name: 'x' })
      .expect(403);
    await client(app)
      .patch(`${projectsUrl(organization.id)}/${randomUUID()}`)
      .set('Authorization', bearer(owner))
      .send({ name: 'x' })
      .expect(404);
  });
});

describe('POST /organizations/:orgId/projects/:projectId/environments', () => {
  it('adds an unprotected environment after the others', async () => {
    const { organization, owner } = await team();
    const project = await createProject(organization.id, owner);
    const preview = await addEnvironment(organization.id, project.id, owner, { name: ' preview ' });
    expect(preview).toMatchObject({ name: 'preview', protected: false });

    const res = await client(app)
      .get(`${projectsUrl(organization.id)}/${project.id}`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(projectSchema.parse(res.body.data).environments.map((e) => e.name)).toEqual([
      'development',
      'staging',
      'production',
      'preview',
    ]);
  });

  it('adds a protected environment', async () => {
    const { organization, admin } = await team();
    const project = await createProject(organization.id, admin);
    const environment = await addEnvironment(organization.id, project.id, admin, {
      name: 'production-eu',
      protected: true,
    });
    expect(environment.protected).toBe(true);
  });

  it('gives environments added at the same moment their own places', async () => {
    const { organization, owner } = await team();
    const project = await createProject(organization.id, owner);
    const names = ['qa-1', 'qa-2', 'qa-3', 'qa-4'];
    await Promise.all(
      names.map((name) => addEnvironment(organization.id, project.id, owner, { name })),
    );

    const rows = await database.pool.query<{ position: number }>(
      'SELECT position FROM environments WHERE project_id = $1',
      [project.id],
    );
    const positions = rows.rows.map((r) => r.position).sort((a, b) => a - b);
    expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("refuses a name the project's environments have, ignoring case", async () => {
    const { organization, owner } = await team();
    const project = await createProject(organization.id, owner);
    const res = await client(app)
      .post(`${projectsUrl(organization.id)}/${project.id}/environments`)
      .set('Authorization', bearer(owner))
      .send({ name: 'Production' })
      .expect(409);
    expect(res.body.error).toMatchObject({ code: 'NAME_TAKEN', details: { field: 'name' } });

    // Another project may use it.
    const other = await createProject(organization.id, owner, 'Other');
    await addEnvironment(organization.id, other.id, owner, { name: 'preview' });
    await addEnvironment(organization.id, project.id, owner, { name: 'preview' });
  });

  it('is for owners and admins, on a project of the organization', async () => {
    const { organization, owner, member, viewer } = await team();
    const project = await createProject(organization.id, owner);
    for (const user of [member, viewer]) {
      await client(app)
        .post(`${projectsUrl(organization.id)}/${project.id}/environments`)
        .set('Authorization', bearer(user))
        .send({ name: 'preview' })
        .expect(403);
    }
    const res = await client(app)
      .post(`${projectsUrl(organization.id)}/${randomUUID()}/environments`)
      .set('Authorization', bearer(owner))
      .send({ name: 'preview' })
      .expect(404);
    expect(res.body.error.message).toBe('Project not found.');
  });
});

describe('PATCH /organizations/:orgId/projects/:projectId/environments/:environmentId', () => {
  it('renames, protects and unprotects an environment', async () => {
    const { organization, admin } = await team();
    const project = await createProject(organization.id, admin);
    const staging = project.environments[1]!;
    const url = `${projectsUrl(organization.id)}/${project.id}/environments/${staging.id}`;

    const renamed = await client(app)
      .patch(url)
      .set('Authorization', bearer(admin))
      .send({ name: 'uat' })
      .expect(200);
    expect(renamed.body.data).toMatchObject({ id: staging.id, name: 'uat', protected: false });

    const protectedNow = await client(app)
      .patch(url)
      .set('Authorization', bearer(admin))
      .send({ protected: true })
      .expect(200);
    expect(protectedNow.body.data).toMatchObject({ name: 'uat', protected: true });

    const both = await client(app)
      .patch(url)
      .set('Authorization', bearer(admin))
      .send({ name: 'staging', protected: false })
      .expect(200);
    expect(environmentSchema.parse(both.body.data)).toEqual({ ...staging });
  });

  it('needs a change, an unused name, and a manager', async () => {
    const { organization, owner, member } = await team();
    const project = await createProject(organization.id, owner);
    const url = `${projectsUrl(organization.id)}/${project.id}/environments/${project.environments[0]!.id}`;

    const empty = await client(app)
      .patch(url)
      .set('Authorization', bearer(owner))
      .send({})
      .expect(400);
    expect(empty.body.error.code).toBe('VALIDATION_FAILED');
    const taken = await client(app)
      .patch(url)
      .set('Authorization', bearer(owner))
      .send({ name: 'STAGING' })
      .expect(409);
    expect(taken.body.error.code).toBe('NAME_TAKEN');
    for (const body of [{ name: 'dev' }, { protected: true }]) {
      await client(app).patch(url).set('Authorization', bearer(member)).send(body).expect(403);
    }
  });

  it("answers 404 for an environment of another project, even the organization's own", async () => {
    const { organization, owner } = await team();
    const project = await createProject(organization.id, owner, 'One');
    const other = await createProject(organization.id, owner, 'Two');
    const res = await client(app)
      .patch(
        `${projectsUrl(organization.id)}/${project.id}/environments/${other.environments[0]!.id}`,
      )
      .set('Authorization', bearer(owner))
      .send({ name: 'moved' })
      .expect(404);
    expect(res.body.error.message).toBe('Environment not found.');
  });
});

describe('isolation between organizations (required test #5)', () => {
  it("never shows or changes another organization's projects and environments", async () => {
    const a = await team();
    const b = await team();
    const projectA = await createProject(a.organization.id, a.owner, 'Shared name');
    const projectB = await createProject(b.organization.id, b.owner, 'Shared name');
    const environmentB = projectB.environments[2]!;
    const as = (user: SignedIn) => ({ Authorization: bearer(user) });

    // Org B's URLs: org A's owner is not a member, so every route is a 404.
    const bUrl = projectsUrl(b.organization.id);
    const bRoutes = [
      client(app).get(bUrl).set(as(a.owner)),
      client(app).post(bUrl).set(as(a.owner)).send({ name: 'x' }),
      client(app).get(`${bUrl}/${projectB.id}`).set(as(a.owner)),
      client(app).patch(`${bUrl}/${projectB.id}`).set(as(a.owner)).send({ name: 'x' }),
      client(app).post(`${bUrl}/${projectB.id}/environments`).set(as(a.owner)).send({ name: 'x' }),
      client(app)
        .patch(`${bUrl}/${projectB.id}/environments/${environmentB.id}`)
        .set(as(a.owner))
        .send({ protected: false }),
    ];
    for (const res of await Promise.all(bRoutes)) {
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Organization not found.');
    }

    // Org A's URLs with org B's ids: the ids are simply not found in org A.
    const aUrl = projectsUrl(a.organization.id);
    const mixed = [
      client(app).get(`${aUrl}/${projectB.id}`).set(as(a.owner)),
      client(app).patch(`${aUrl}/${projectB.id}`).set(as(a.owner)).send({ name: 'x' }),
      client(app).post(`${aUrl}/${projectB.id}/environments`).set(as(a.owner)).send({ name: 'x' }),
      client(app)
        .patch(`${aUrl}/${projectB.id}/environments/${environmentB.id}`)
        .set(as(a.owner))
        .send({ protected: false }),
      client(app)
        .patch(`${aUrl}/${projectA.id}/environments/${environmentB.id}`)
        .set(as(a.owner))
        .send({ protected: false }),
    ];
    for (const res of await Promise.all(mixed)) expect(res.status).toBe(404);

    // Org B's project is untouched.
    const after = await client(app).get(`${bUrl}/${projectB.id}`).set(as(b.owner)).expect(200);
    expect(projectSchema.parse(after.body.data)).toEqual(projectB);
  });
});
