import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  invitationPreviewSchema,
  invitationSchema,
  organizationSchema,
  type OrganizationRole,
} from '@forgeflow/contracts';
import {
  createDatabase,
  invitations,
  memberships,
  users,
  type DatabaseHandle,
} from '@forgeflow/database';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from '../../../src/app.factory.js';
import {
  APP_ORIGIN,
  bearer,
  client,
  envFor,
  registerUser,
  uniqueEmail,
  type SignedIn,
} from '../../support/http.js';
import { linkIn, testSmtpUrl, waitForEmailTo } from '../../support/mailpit.js';
import { addMember, createOrganization, verifiedUser } from '../../support/organizations.js';
import { testOwnerDatabaseUrl } from '../../support/test-database.js';

const SUBJECT = 'invited you to';

let database: DatabaseHandle;
let app: INestApplication;

beforeAll(async () => {
  database = createDatabase(testOwnerDatabaseUrl(), { max: 2 });
  app = await createApp(envFor({ SMTP_URL: testSmtpUrl() }));
  await app.init();
});

afterAll(async () => {
  await app.close();
  await database.close();
});

const invite = (orgId: string, actor: SignedIn, email: string, role: OrganizationRole = 'member') =>
  client(app)
    .post(`/api/v1/organizations/${orgId}/invitations`)
    .set('Authorization', bearer(actor))
    .send({ email, role });
const lookup = (token: string) => client(app).post('/api/v1/invitations/lookup').send({ token });
const accept = (user: SignedIn, token: string) =>
  client(app).post('/api/v1/invitations/accept').set('Authorization', bearer(user)).send({ token });

async function owned(name = 'Acme') {
  const owner = await verifiedUser(app, database, { name: 'Olivia Owner' });
  const organization = await createOrganization(app, owner, name);
  return { owner, orgId: organization.id };
}

async function invitationLink(email: string, count = 1) {
  return linkIn(await waitForEmailTo(email, { subject: SUBJECT, count }));
}

describe('inviting', () => {
  it('emails a link that shows what it offers and joins the invitee with the role', async () => {
    const { owner, orgId } = await owned('Công ty Acme');
    const email = uniqueEmail();
    const created = await invite(orgId, owner, email.toUpperCase(), 'admin').expect(201);
    expect(invitationSchema.parse(created.body.data)).toMatchObject({
      email,
      role: 'admin',
      invitedBy: { name: 'Olivia Owner', email: owner.email },
    });

    const message = await waitForEmailTo(email, { subject: SUBJECT });
    expect(message.Subject).toBe('Olivia Owner invited you to Công ty Acme on ForgeFlow');
    const { url, token } = linkIn(message);
    expect(url).toBe(`${APP_ORIGIN}/invitations/accept#token=${token}`);

    const preview = invitationPreviewSchema.parse((await lookup(token).expect(200)).body.data);
    expect(preview).toMatchObject({
      organization: { id: orgId, name: 'Công ty Acme' },
      email,
      role: 'admin',
      invitedBy: { name: 'Olivia Owner' },
    });

    // The invitee signs up with the invited address (unverified until now) and accepts.
    const invitee = await registerUser(app, { email });
    const joined = await accept(invitee, token).expect(200);
    expect(organizationSchema.parse(joined.body.data)).toMatchObject({ id: orgId, role: 'admin' });

    const [stored] = await database.db.select().from(users).where(eq(users.email, email));
    expect(stored?.emailVerifiedAt).not.toBeNull();
    const pending = await client(app)
      .get(`/api/v1/organizations/${orgId}/invitations`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(pending.body.data).toEqual([]);

    await accept(invitee, token).expect(400);
    await lookup(token).expect(400);
  });

  it('lists pending invitations to owners and admins', async () => {
    const { owner, orgId } = await owned();
    const email = uniqueEmail();
    await invite(orgId, owner, email).expect(201);

    const res = await client(app)
      .get(`/api/v1/organizations/${orgId}/invitations`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(
      z
        .array(invitationSchema)
        .parse(res.body.data)
        .map((i) => i.email),
    ).toEqual([email]);
  });

  it('only lets owners and admins invite, and admins only as member or viewer', async () => {
    const { owner, orgId } = await owned();
    const admin = await registerUser(app);
    const member = await registerUser(app);
    await addMember(database, orgId, admin, 'admin');
    await addMember(database, orgId, member, 'member');
    await database.db
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(users.id, admin.body.user.id));

    await invite(orgId, admin, uniqueEmail(), 'viewer').expect(201);
    for (const role of ['admin', 'owner'] as const) {
      const res = await invite(orgId, admin, uniqueEmail(), role).expect(403);
      expect(res.body.error.code).toBe('ROLE_NOT_ALLOWED');
    }
    const byMember = await invite(orgId, member, uniqueEmail()).expect(403);
    expect(byMember.body.error.code).toBe('ROLE_NOT_ALLOWED');
    await invite(orgId, owner, uniqueEmail(), 'owner').expect(201);
  });

  it('needs the inviter to have a verified email', async () => {
    const { orgId } = await owned();
    const admin = await registerUser(app);
    await addMember(database, orgId, admin, 'admin');
    const res = await invite(orgId, admin, uniqueEmail()).expect(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('refuses to invite someone who is already a member', async () => {
    const { owner, orgId } = await owned();
    const member = await registerUser(app);
    await addMember(database, orgId, member, 'viewer');
    const res = await invite(orgId, owner, member.email.toUpperCase()).expect(409);
    expect(res.body.error.code).toBe('ALREADY_MEMBER');
  });

  it('a new invitation to the same email replaces the earlier link', async () => {
    const { owner, orgId } = await owned();
    const email = uniqueEmail();
    await invite(orgId, owner, email, 'viewer').expect(201);
    const first = await invitationLink(email);
    await invite(orgId, owner, email, 'member').expect(201);
    const second = await invitationLink(email, 2);

    await lookup(first.token).expect(400);
    const preview = await lookup(second.token).expect(200);
    expect(preview.body.data.role).toBe('member');
  });
});

describe('accepting', () => {
  it('needs the signed-in user to have the invited email, and keeps the link usable', async () => {
    const { owner, orgId } = await owned();
    const email = uniqueEmail();
    await invite(orgId, owner, email).expect(201);
    const { token } = await invitationLink(email);

    const someoneElse = await registerUser(app);
    const res = await accept(someoneElse, token).expect(403);
    expect(res.body.error).toMatchObject({
      code: 'INVITATION_EMAIL_MISMATCH',
      details: { invitedEmail: email },
    });
    await lookup(token).expect(200);

    await client(app).post('/api/v1/invitations/accept').send({ token }).expect(401);
  });

  it('refuses revoked and expired invitations', async () => {
    const { owner, orgId } = await owned();
    const revokedEmail = uniqueEmail();
    const created = await invite(orgId, owner, revokedEmail).expect(201);
    const revokedLink = await invitationLink(revokedEmail);
    await client(app)
      .delete(`/api/v1/organizations/${orgId}/invitations/${created.body.data.id}`)
      .set('Authorization', bearer(owner))
      .expect(204);
    await lookup(revokedLink.token).expect(400);

    const expiredEmail = uniqueEmail();
    await invite(orgId, owner, expiredEmail).expect(201);
    const expiredLink = await invitationLink(expiredEmail);
    await database.db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(invitations.organizationId, orgId), eq(invitations.email, expiredEmail)));
    const invitee = await registerUser(app, { email: expiredEmail });
    const res = await accept(invitee, expiredLink.token).expect(400);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('keeps the current role of someone who joined in the meantime', async () => {
    const { owner, orgId } = await owned();
    const email = uniqueEmail();
    await invite(orgId, owner, email, 'viewer').expect(201);
    const { token } = await invitationLink(email);
    const invitee = await registerUser(app, { email });
    await addMember(database, orgId, invitee, 'admin');

    const res = await accept(invitee, token).expect(200);
    expect(res.body.data.role).toBe('admin');
    const rows = await database.db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, invitee.body.user.id));
    expect(rows).toHaveLength(1);
  });

  it('answers 404 when revoking an unknown invitation', async () => {
    const { owner, orgId } = await owned();
    await client(app)
      .delete(`/api/v1/organizations/${orgId}/invitations/00000000-0000-4000-8000-000000000000`)
      .set('Authorization', bearer(owner))
      .expect(404);
  });
});

describe('with the SMTP server down', () => {
  it('reports the failure and leaves no pending invitation behind', async () => {
    const down = await createApp(envFor());
    await down.init();
    try {
      const owner = await verifiedUser(down, database);
      const organization = await createOrganization(down, owner);
      const res = await client(down)
        .post(`/api/v1/organizations/${organization.id}/invitations`)
        .set('Authorization', bearer(owner))
        .send({ email: uniqueEmail(), role: 'member' })
        .expect(503);
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');

      const pending = await client(down)
        .get(`/api/v1/organizations/${organization.id}/invitations`)
        .set('Authorization', bearer(owner))
        .expect(200);
      expect(pending.body.data).toEqual([]);
    } finally {
      await down.close();
    }
  });
});
