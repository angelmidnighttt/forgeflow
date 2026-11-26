import { Inject, Injectable } from '@nestjs/common';
import type { Organization, OrganizationRole } from '@forgeflow/contracts';
import {
  memberships,
  organizations,
  type DatabaseHandle,
  type OrganizationRow,
} from '@forgeflow/database';
import { asc, eq } from 'drizzle-orm';
import { DATABASE } from '../../common/constants/injection-tokens.js';

@Injectable()
export class OrganizationsService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  /** Creates an organization with `ownerId` as its first owner, in one transaction. */
  async create(ownerId: string, name: string): Promise<Organization> {
    return this.database.db.transaction(async (tx) => {
      const [organization] = await tx.insert(organizations).values({ name }).returning();
      if (!organization) throw new Error('Organization insert returned no row');
      await tx
        .insert(memberships)
        .values({ organizationId: organization.id, userId: ownerId, role: 'owner' });
      return toOrganization(organization, 'owner');
    });
  }

  /** The organizations `userId` belongs to, with their role in each, by name. */
  async listForUser(userId: string): Promise<Organization[]> {
    const rows = await this.database.db
      .select({ organization: organizations, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(organizations.name), asc(organizations.createdAt));
    return rows.map((row) => toOrganization(row.organization, row.role));
  }

  /** The organization, as seen by a member with `role` (the caller). */
  async get(organizationId: string, role: OrganizationRole): Promise<Organization | undefined> {
    const [organization] = await this.database.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return organization ? toOrganization(organization, role) : undefined;
  }

  async rename(
    organizationId: string,
    role: OrganizationRole,
    name: string,
  ): Promise<Organization | undefined> {
    const [organization] = await this.database.db
      .update(organizations)
      .set({ name })
      .where(eq(organizations.id, organizationId))
      .returning();
    return organization ? toOrganization(organization, role) : undefined;
  }

  async nameOf(organizationId: string): Promise<string | undefined> {
    const [row] = await this.database.db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return row?.name;
  }
}

export function toOrganization(row: OrganizationRow, role: OrganizationRole): Organization {
  return { id: row.id, name: row.name, role, createdAt: row.createdAt.toISOString() };
}
