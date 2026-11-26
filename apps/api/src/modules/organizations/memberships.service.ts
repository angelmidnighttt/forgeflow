import { Inject, Injectable } from '@nestjs/common';
import {
  canAssignRole,
  canManageMember,
  type Member,
  type OrganizationRole,
} from '@forgeflow/contracts';
import {
  memberships,
  organizations,
  users,
  type DatabaseHandle,
  type DbExecutor,
} from '@forgeflow/database';
import { and, asc, count, eq } from 'drizzle-orm';
import { DATABASE } from '../../common/constants/injection-tokens.js';
import type {
  ChangeRoleOutcome,
  MembershipContext,
  RemoveMemberOutcome,
} from '../../common/types/organization.types.js';

/**
 * Members of organizations and their roles. Every change runs in a transaction that first
 * locks the organization row, so concurrent changes are serialized and the "at least one
 * owner" rule cannot be broken by two owners demoting each other at the same moment. The
 * actor's own role is read again inside that transaction for the same reason.
 */
@Injectable()
export class MembershipsService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async findRole(
    organizationId: string,
    userId: string,
    db: DbExecutor = this.database.db,
  ): Promise<OrganizationRole | undefined> {
    const [row] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
      .limit(1);
    return row?.role;
  }

  /** Members in the order they joined. */
  async list(organizationId: string): Promise<Member[]> {
    const rows = await this.memberQuery(this.database.db)
      .where(eq(memberships.organizationId, organizationId))
      .orderBy(asc(memberships.createdAt));
    return rows.map(toMember);
  }

  async changeRole(
    actor: MembershipContext,
    targetUserId: string,
    role: OrganizationRole,
  ): Promise<ChangeRoleOutcome> {
    return this.database.db.transaction(async (tx): Promise<ChangeRoleOutcome> => {
      const actorRole = await this.lockAndReadRole(tx, actor);
      if (!actorRole) return { status: 'role_not_allowed' };
      const target = await this.findMember(tx, actor.organizationId, targetUserId);
      if (!target) return { status: 'not_found' };
      if (!canManageMember(actorRole, target.role) || !canAssignRole(actorRole, role)) {
        return { status: 'role_not_allowed' };
      }
      if (target.role === 'owner' && role !== 'owner') {
        if ((await this.countOwners(tx, actor.organizationId)) <= 1)
          return { status: 'last_owner' };
      }
      await tx
        .update(memberships)
        .set({ role })
        .where(
          and(
            eq(memberships.organizationId, actor.organizationId),
            eq(memberships.userId, targetUserId),
          ),
        );
      return { status: 'changed', member: { ...target, role } };
    });
  }

  /**
   * Removes `targetUserId` from the organization. Any member may remove themselves (leave);
   * removing someone else needs canManageMember.
   */
  async remove(actor: MembershipContext, targetUserId: string): Promise<RemoveMemberOutcome> {
    return this.database.db.transaction(async (tx): Promise<RemoveMemberOutcome> => {
      const actorRole = await this.lockAndReadRole(tx, actor);
      if (!actorRole) return 'role_not_allowed';
      const target = await this.findMember(tx, actor.organizationId, targetUserId);
      if (!target) return 'not_found';
      const leaving = targetUserId === actor.userId;
      if (!leaving && !canManageMember(actorRole, target.role)) return 'role_not_allowed';
      if (target.role === 'owner' && (await this.countOwners(tx, actor.organizationId)) <= 1) {
        return 'last_owner';
      }
      await tx
        .delete(memberships)
        .where(
          and(
            eq(memberships.organizationId, actor.organizationId),
            eq(memberships.userId, targetUserId),
          ),
        );
      return 'removed';
    });
  }

  /** Locks the organization row for the rest of the transaction; returns the actor's role now. */
  private async lockAndReadRole(
    tx: DbExecutor,
    actor: MembershipContext,
  ): Promise<OrganizationRole | undefined> {
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, actor.organizationId))
      .for('update');
    return this.findRole(actor.organizationId, actor.userId, tx);
  }

  private async findMember(
    db: DbExecutor,
    organizationId: string,
    userId: string,
  ): Promise<Member | undefined> {
    const [row] = await this.memberQuery(db)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
      .limit(1);
    return row ? toMember(row) : undefined;
  }

  private async countOwners(db: DbExecutor, organizationId: string): Promise<number> {
    const [row] = await db
      .select({ owners: count() })
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, 'owner')));
    return row?.owners ?? 0;
  }

  private memberQuery(db: DbExecutor) {
    return db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        role: memberships.role,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .$dynamic();
  }
}

function toMember(row: {
  userId: string;
  name: string | null;
  email: string;
  role: OrganizationRole;
  joinedAt: Date;
}): Member {
  return { ...row, joinedAt: row.joinedAt.toISOString() };
}
