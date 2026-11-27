import { randomUUID } from 'node:crypto';
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
import type { AuditActor } from '../../common/types/audit.types.js';
import { AuditService } from '../audit/audit.service.js';

/** Organizations. Every query runs in a tenant context (row-level security, ADR-0002). */
@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Creates an organization with `actor` as its first owner, in one transaction. The id is
   * made here so that it can be the tenant context of the insert: row-level security only lets
   * `INSERT … RETURNING` see the row of the organization in the context.
   */
  async create(actor: AuditActor, name: string): Promise<Organization> {
    const id = randomUUID();
    return this.database.withTenant({ organizationId: id, userId: actor.userId }, async (tx) => {
      const [organization] = await tx.insert(organizations).values({ id, name }).returning();
      if (!organization) throw new Error('Organization insert returned no row');
      await tx
        .insert(memberships)
        .values({ organizationId: id, userId: actor.userId, role: 'owner' });
      await this.audit.record(tx, {
        organizationId: id,
        actor,
        action: 'organization.created',
        target: { type: 'organization', id },
        metadata: { name },
      });
      return toOrganization(organization, 'owner');
    });
  }

  /**
   * The organizations `userId` belongs to, with their role in each, by name. Runs with only the
   * user in the context: the policies let a user read their own memberships and the
   * organizations they belong to, in every organization.
   */
  async listForUser(userId: string): Promise<Organization[]> {
    const rows = await this.database.withTenant({ userId }, (tx) =>
      tx
        .select({ organization: organizations, role: memberships.role })
        .from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
        .where(eq(memberships.userId, userId))
        .orderBy(asc(organizations.name), asc(organizations.createdAt)),
    );
    return rows.map((row) => toOrganization(row.organization, row.role));
  }

  /** The organization, as seen by a member with `role` (the caller). */
  async get(organizationId: string, role: OrganizationRole): Promise<Organization | undefined> {
    const [organization] = await this.database.withTenant({ organizationId }, (tx) =>
      tx.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1),
    );
    return organization ? toOrganization(organization, role) : undefined;
  }

  async rename(
    organizationId: string,
    role: OrganizationRole,
    name: string,
    actor: AuditActor,
  ): Promise<Organization | undefined> {
    return this.database.withTenant({ organizationId }, async (tx) => {
      const [before] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .for('update');
      if (!before) return undefined;
      const [organization] = await tx
        .update(organizations)
        .set({ name })
        .where(eq(organizations.id, organizationId))
        .returning();
      if (!organization) return undefined;
      if (before.name !== name) {
        await this.audit.record(tx, {
          organizationId,
          actor,
          action: 'organization.renamed',
          target: { type: 'organization', id: organizationId },
          metadata: { from: before.name, to: name },
        });
      }
      return toOrganization(organization, role);
    });
  }

  async nameOf(organizationId: string): Promise<string | undefined> {
    const [row] = await this.database.withTenant({ organizationId }, (tx) =>
      tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1),
    );
    return row?.name;
  }
}

export function toOrganization(row: OrganizationRow, role: OrganizationRole): Organization {
  return { id: row.id, name: row.name, role, createdAt: row.createdAt.toISOString() };
}
