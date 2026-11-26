import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { memberSchema, type OrganizationRole } from '@forgeflow/contracts';
import { createDatabase, memberships, type DatabaseHandle } from '@forgeflow/database';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from '../../../src/app.factory.js';
import { bearer, client, envFor, registerUser, type SignedIn } from '../../support/http.js';
import { addMember, createOrganization, verifiedUser } from '../../support/organizations.js';
import { testDatabaseUrl } from '../../support/test-database.js';

let database: DatabaseHandle;
let app: INestApplication;

beforeAll(async () => {
  database = createDatabase(testDatabaseUrl(), { max: 4 });
  app = await createApp(envFor());
  await app.init();
});

afterAll(async () => {
  await app.close();
  await database.close();
});

/** An organization with one user per role. */
async function team() {
  const owner = await verifiedUser(app, database, { name: 'Owner' });
  const organization = await createOrganization(app, owner);
  const users: Record<OrganizationRole, SignedIn> = {
    owner,
    admin: await registerUser(app, { name: 'Admin' }),
    member: await registerUser(app, { name: 'Member' }),
    viewer: await registerUser(app, { name: 'Viewer' }),
  };
  for (const role of ['admin', 'member', 'viewer'] as const) {
    await addMember(database, organization.id, users[role], role);
  }
  return { orgId: organization.id, ...users };
}

const membersPath = (orgId: string) => `/api/v1/organizations/${orgId}/members`;
const setRole = (orgId: string, actor: SignedIn, target: SignedIn, role: OrganizationRole) =>
  client(app)
    .patch(`${membersPath(orgId)}/${target.body.user.id}`)
    .set('Authorization', bearer(actor))
    .send({ role });
const remove = (orgId: string, actor: SignedIn, target: SignedIn) =>
  client(app)
    .delete(`${membersPath(orgId)}/${target.body.user.id}`)
    .set('Authorization', bearer(actor));

async function roleOf(orgId: string, user: SignedIn) {
  const [row] = await database.db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.organizationId, orgId), eq(memberships.userId, user.body.user.id)));
  return row?.role;
}

describe('GET /organizations/:orgId/members', () => {
  it('lists every member, with name, email and role, to every role', async () => {
    const t = await team();
    for (const reader of [t.owner, t.admin, t.member, t.viewer]) {
      const res = await client(app)
        .get(membersPath(t.orgId))
        .set('Authorization', bearer(reader))
        .expect(200);
      const members = z.array(memberSchema).parse(res.body.data);
      expect(members.map((m) => [m.name, m.role])).toEqual([
        ['Owner', 'owner'],
        ['Admin', 'admin'],
        ['Member', 'member'],
        ['Viewer', 'viewer'],
      ]);
    }
  });
});

describe('changing roles', () => {
  it('lets an owner give any role, an owner role included', async () => {
    const t = await team();
    await setRole(t.orgId, t.owner, t.member, 'admin').expect(200);
    const res = await setRole(t.orgId, t.owner, t.admin, 'owner').expect(200);
    expect(res.body.data).toMatchObject({ userId: t.admin.body.user.id, role: 'owner' });
    expect(await roleOf(t.orgId, t.admin)).toBe('owner');
  });

  it('lets an admin move people between member and viewer, nothing more', async () => {
    const t = await team();
    await setRole(t.orgId, t.admin, t.member, 'viewer').expect(200);
    await setRole(t.orgId, t.admin, t.viewer, 'member').expect(200);

    for (const [target, role] of [
      [t.member, 'admin'],
      [t.member, 'owner'],
      [t.owner, 'viewer'],
    ] as const) {
      const res = await setRole(t.orgId, t.admin, target, role).expect(403);
      expect(res.body.error.code).toBe('ROLE_NOT_ALLOWED');
    }
    const other = await registerUser(app);
    await addMember(database, t.orgId, other, 'admin');
    await setRole(t.orgId, t.admin, other, 'member').expect(403);
  });

  it('refuses members and viewers before looking at the target', async () => {
    const t = await team();
    for (const actor of [t.member, t.viewer]) {
      const res = await setRole(t.orgId, actor, t.viewer, 'member').expect(403);
      expect(res.body.error.code).toBe('ROLE_NOT_ALLOWED');
    }
  });

  it('answers 404 for someone who is not a member and 400 for a malformed id', async () => {
    const t = await team();
    const outsider = await registerUser(app);
    await setRole(t.orgId, t.owner, outsider, 'member').expect(404);
    await client(app)
      .patch(`${membersPath(t.orgId)}/${randomUUID()}`)
      .set('Authorization', bearer(t.owner))
      .send({ role: 'member' })
      .expect(404);
    await client(app)
      .patch(`${membersPath(t.orgId)}/not-a-uuid`)
      .set('Authorization', bearer(t.owner))
      .send({ role: 'member' })
      .expect(400);
  });
});

describe('the organization always keeps an owner', () => {
  it('refuses to demote or remove the only owner, who cannot leave either', async () => {
    const t = await team();
    const demote = await setRole(t.orgId, t.owner, t.owner, 'admin').expect(409);
    expect(demote.body.error.code).toBe('LAST_OWNER');
    await remove(t.orgId, t.owner, t.owner).expect(409);
    expect(await roleOf(t.orgId, t.owner)).toBe('owner');
  });

  it('lets one of two owners step down or leave', async () => {
    const t = await team();
    await setRole(t.orgId, t.owner, t.admin, 'owner').expect(200);
    await setRole(t.orgId, t.owner, t.owner, 'admin').expect(200);
    await remove(t.orgId, t.admin, t.admin).expect(409);
    expect(await roleOf(t.orgId, t.admin)).toBe('owner');
  });

  it('two owners demoting each other at the same moment cannot both succeed', async () => {
    const t = await team();
    await setRole(t.orgId, t.owner, t.admin, 'owner').expect(200);

    const results = await Promise.all([
      setRole(t.orgId, t.owner, t.admin, 'member'),
      setRole(t.orgId, t.admin, t.owner, 'member'),
    ]);
    // The first demotion wins; the second actor is no longer an owner (or would be the last).
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    const owners = await database.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.organizationId, t.orgId), eq(memberships.role, 'owner')));
    expect(owners).toHaveLength(1);
  });
});

describe('removing members', () => {
  it('ends access at once for the removed member', async () => {
    const t = await team();
    await client(app)
      .get(`/api/v1/organizations/${t.orgId}`)
      .set('Authorization', bearer(t.member))
      .expect(200);
    await remove(t.orgId, t.admin, t.member).expect(204);
    await client(app)
      .get(`/api/v1/organizations/${t.orgId}`)
      .set('Authorization', bearer(t.member))
      .expect(404);
  });

  it('follows the same hierarchy as role changes', async () => {
    const t = await team();
    await remove(t.orgId, t.admin, t.owner).expect(403);
    await remove(t.orgId, t.member, t.viewer).expect(403);
    await remove(t.orgId, t.viewer, t.member).expect(403);
    await remove(t.orgId, t.owner, t.admin).expect(204);
  });

  it('lets any member leave', async () => {
    const t = await team();
    for (const user of [t.viewer, t.member, t.admin]) {
      await remove(t.orgId, user, user).expect(204);
      expect(await roleOf(t.orgId, user)).toBeUndefined();
    }
  });
});
