import type { INestApplication } from '@nestjs/common';
import { organizationSchema, type Organization, type OrganizationRole } from '@forgeflow/contracts';
import { memberships, users, type DatabaseHandle } from '@forgeflow/database';
import { eq } from 'drizzle-orm';
import { bearer, client, registerUser, type SignedIn } from './http.js';

/** Registers a user through the API and marks their email verified (as the link would). */
export async function verifiedUser(
  app: INestApplication,
  database: DatabaseHandle,
  options: { email?: string; name?: string } = {},
): Promise<SignedIn> {
  const user = await registerUser(app, options);
  await database.db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(users.id, user.body.user.id));
  return user;
}

export async function createOrganization(
  app: INestApplication,
  owner: SignedIn,
  name = 'Acme',
): Promise<Organization> {
  const res = await client(app)
    .post('/api/v1/organizations')
    .set('Authorization', bearer(owner))
    .send({ name })
    .expect(201);
  return organizationSchema.parse(res.body.data);
}

/** Adds `user` to the organization directly in the database, for test setup. */
export async function addMember(
  database: DatabaseHandle,
  organizationId: string,
  user: SignedIn,
  role: OrganizationRole,
): Promise<void> {
  await database.db.insert(memberships).values({ organizationId, userId: user.body.user.id, role });
}
