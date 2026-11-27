import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  canAssignRole,
  type CreateInvitationRequest,
  type Invitation,
  type InvitationPreview,
} from '@forgeflow/contracts';
import {
  invitations,
  memberships,
  organizations,
  users,
  type DatabaseHandle,
  type InvitationRow,
} from '@forgeflow/database';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { WEB_PATHS } from '../../common/constants/auth.constants.js';
import { API_ENV, CLOCK, DATABASE } from '../../common/constants/injection-tokens.js';
import { INVITATION_TTL_MS, ROLE_LABELS } from '../../common/constants/organization.constants.js';
import { invitationTemplate } from '../../common/templates/invitation.template.js';
import type { AuditActor } from '../../common/types/audit.types.js';
import type { Clock } from '../../common/types/clock.types.js';
import type {
  AcceptInvitationOutcome,
  CreateInvitationOutcome,
  MembershipContext,
} from '../../common/types/organization.types.js';
import {
  generateSecretToken,
  hashSecretToken,
  isSecretToken,
} from '../../common/utils/secret-token.util.js';
import { webLink } from '../../common/utils/web-link.util.js';
import type { ApiEnv } from '../../config/env.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { UsersService } from '../users/users.service.js';
import { MembershipsService } from './memberships.service.js';
import { OrganizationsService, toOrganization } from './organizations.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Still usable: neither accepted nor revoked, and not expired at `now`. */
const usable = (now: Date) =>
  and(
    isNull(invitations.acceptedAt),
    isNull(invitations.revokedAt),
    gt(invitations.expiresAt, now),
  );
/** Not accepted nor revoked (possibly expired): blocks a second invitation to the same email. */
const pending = () => and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));

/**
 * Invitations to join an organization by email. The link carries a one-time secret (only its
 * hash is stored) that works for 7 days, and only for a user signed in with the invited email.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly now: Clock,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(MembershipsService) private readonly memberships: MembershipsService,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Invites `input.email` with `input.role` and emails the link. A pending invitation to the
   * same address is replaced, so only the newest link works. If the email cannot be sent the
   * invitation is withdrawn again, and the caller is told to retry.
   */
  async create(
    actor: MembershipContext,
    input: CreateInvitationRequest,
    by: AuditActor,
  ): Promise<CreateInvitationOutcome> {
    if (!canAssignRole(actor.role, input.role)) return { status: 'role_not_allowed' };
    const email = input.email.toLowerCase();
    const existingUser = await this.users.findByEmail(email);
    if (existingUser && (await this.memberships.findRole(actor.organizationId, existingUser.id))) {
      return { status: 'already_member' };
    }

    const now = this.now();
    const secret = generateSecretToken();
    const row = await this.database.withTenant(tenantOf(actor), async (tx) => {
      await tx
        .update(invitations)
        .set({ revokedAt: now })
        .where(
          and(
            eq(invitations.organizationId, actor.organizationId),
            eq(invitations.email, email),
            pending(),
          ),
        );
      const [created] = await tx
        .insert(invitations)
        .values({
          organizationId: actor.organizationId,
          email,
          role: input.role,
          tokenHash: hashSecretToken(secret),
          invitedBy: actor.userId,
          createdAt: now,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        })
        .returning();
      if (!created) throw new Error('Invitation insert returned no row');
      await this.audit.record(tx, {
        organizationId: actor.organizationId,
        actor: by,
        action: 'invitation.created',
        target: { type: 'invitation', id: created.id },
        metadata: { email, role: input.role },
      });
      return created;
    });

    const organizationName = await this.organizations.nameOf(actor.organizationId);
    const inviter = await this.users.findById(actor.userId);
    try {
      await this.mail.send({
        to: email,
        ...invitationTemplate({
          inviterName: inviter?.name ?? null,
          inviterEmail: inviter?.email ?? 'a ForgeFlow user',
          organizationName: organizationName ?? 'an organization',
          roleLabel: ROLE_LABELS[input.role],
          url: webLink(this.env.APP_ORIGIN, WEB_PATHS.acceptInvitation, secret),
          invitedEmail: email,
          expiresInDays: INVITATION_TTL_MS / DAY_MS,
        }),
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Could not send the invitation email');
      await this.database.withTenant(tenantOf(actor), async (tx) => {
        await tx
          .update(invitations)
          .set({ revokedAt: this.now() })
          .where(eq(invitations.id, row.id));
        await this.audit.record(tx, {
          organizationId: actor.organizationId,
          actor: by,
          action: 'invitation.revoked',
          target: { type: 'invitation', id: row.id },
          metadata: { email, role: input.role, reason: 'email_not_sent' },
        });
      });
      return { status: 'send_failed' };
    }

    return {
      status: 'created',
      invitation: toInvitation(row, inviter ? { name: inviter.name, email: inviter.email } : null),
    };
  }

  /** Invitations not accepted or revoked yet, newest first (expired ones included). */
  async listPending(organizationId: string): Promise<Invitation[]> {
    const rows = await this.database.withTenant({ organizationId }, (tx) =>
      tx
        .select({ invitation: invitations, inviterName: users.name, inviterEmail: users.email })
        .from(invitations)
        .leftJoin(users, eq(users.id, invitations.invitedBy))
        .where(and(eq(invitations.organizationId, organizationId), pending()))
        .orderBy(desc(invitations.createdAt)),
    );
    return rows.map((row) =>
      toInvitation(
        row.invitation,
        row.inviterEmail ? { name: row.inviterName, email: row.inviterEmail } : null,
      ),
    );
  }

  /** Withdraws a pending invitation; false when there is none with that id in the organization. */
  async revoke(organizationId: string, invitationId: string, by: AuditActor): Promise<boolean> {
    return this.database.withTenant({ organizationId }, async (tx) => {
      const [revoked] = await tx
        .update(invitations)
        .set({ revokedAt: this.now() })
        .where(
          and(
            eq(invitations.id, invitationId),
            eq(invitations.organizationId, organizationId),
            pending(),
          ),
        )
        .returning({ id: invitations.id, email: invitations.email, role: invitations.role });
      if (!revoked) return false;
      await this.audit.record(tx, {
        organizationId,
        actor: by,
        action: 'invitation.revoked',
        target: { type: 'invitation', id: revoked.id },
        metadata: { email: revoked.email, role: revoked.role },
      });
      return true;
    });
  }

  /** What the link behind `secret` offers, or undefined when it cannot be used. */
  async preview(secret: string): Promise<InvitationPreview | undefined> {
    const organizationId = await this.organizationOfToken(secret);
    if (!organizationId) return undefined;
    const [row] = await this.database.withTenant({ organizationId }, (tx) =>
      tx
        .select({
          invitation: invitations,
          organizationName: organizations.name,
          inviterName: users.name,
          inviterExists: users.id,
        })
        .from(invitations)
        .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
        .leftJoin(users, eq(users.id, invitations.invitedBy))
        .where(and(eq(invitations.tokenHash, hashSecretToken(secret)), usable(this.now())))
        .limit(1),
    );
    if (!row) return undefined;
    return {
      organization: { id: row.invitation.organizationId, name: row.organizationName },
      email: row.invitation.email,
      role: row.invitation.role,
      invitedBy: row.inviterExists ? { name: row.inviterName } : null,
      expiresAt: row.invitation.expiresAt.toISOString(),
    };
  }

  /**
   * Joins `userId` to the organization of the invitation behind `secret`. The invitation is
   * locked, so it is used at most once; the signed-in user's email must be the invited one.
   * Following the emailed link also proves the inbox, so the email counts as verified. A user
   * who is already a member keeps their current role.
   */
  async accept(by: AuditActor, secret: string): Promise<AcceptInvitationOutcome> {
    const userId = by.userId;
    const organizationId = await this.organizationOfToken(secret);
    if (!organizationId) return { status: 'invalid' };
    const user = await this.users.findById(userId);
    if (!user) return { status: 'invalid' };

    const context = { organizationId, userId };
    return this.database.withTenant(context, async (tx): Promise<AcceptInvitationOutcome> => {
      const now = this.now();
      const [invitation] = await tx
        .select()
        .from(invitations)
        .where(and(eq(invitations.tokenHash, hashSecretToken(secret)), usable(now)))
        .limit(1)
        .for('update');
      if (!invitation) return { status: 'invalid' };
      if (user.email.toLowerCase() !== invitation.email) {
        return { status: 'email_mismatch', invitedEmail: invitation.email };
      }

      const joined = await tx
        .insert(memberships)
        .values({ organizationId: invitation.organizationId, userId, role: invitation.role })
        .onConflictDoNothing()
        .returning({ id: memberships.id });
      await tx
        .update(invitations)
        .set({ acceptedAt: now, acceptedBy: userId })
        .where(eq(invitations.id, invitation.id));
      await this.audit.record(tx, {
        organizationId: invitation.organizationId,
        actor: by,
        action: 'invitation.accepted',
        target: { type: 'invitation', id: invitation.id },
        metadata: {
          email: invitation.email,
          role: invitation.role,
          // Already a member: they keep their role; the invitation is used up all the same.
          alreadyMember: joined.length === 0,
        },
      });
      await this.users.markEmailVerified(userId, now, tx);

      const role = await this.memberships.findRole(invitation.organizationId, userId, tx);
      const [organization] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, invitation.organizationId));
      if (!role || !organization) throw new Error('Membership missing right after accepting');
      return { status: 'accepted', organization: toOrganization(organization, role) };
    });
  }

  /**
   * The organization of the invitation behind `secret`, if any. This is the "system" path of
   * ADR-0002: the request has no tenant context yet, so a narrow SECURITY DEFINER function
   * returns only the organization id; everything else then runs under row-level security.
   */
  private async organizationOfToken(secret: string): Promise<string | undefined> {
    if (!isSecretToken(secret)) return undefined;
    const result = await this.database.db.execute<{ organization_id: string | null }>(
      sql`select forgeflow_invitation_organization(${hashSecretToken(secret)}) as organization_id`,
    );
    return result.rows[0]?.organization_id ?? undefined;
  }
}

/** The tenant context of an action taken by `actor` in their organization. */
function tenantOf(actor: MembershipContext) {
  return { organizationId: actor.organizationId, userId: actor.userId };
}

function toInvitation(
  row: InvitationRow,
  invitedBy: { name: string | null; email: string } | null,
): Invitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    invitedBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}
