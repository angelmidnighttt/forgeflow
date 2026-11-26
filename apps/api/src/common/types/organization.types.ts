import type { Invitation, Member, Organization, OrganizationRole } from '@forgeflow/contracts';
import type { AuthenticatedRequest } from './auth.types.js';

/** The caller's membership in the organization of the route, set by OrgPermissionGuard. */
export interface MembershipContext {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}

export type OrganizationRequest = AuthenticatedRequest & { membership?: MembershipContext };

export type ChangeRoleOutcome =
  | { status: 'changed'; member: Member }
  | { status: 'not_found' | 'role_not_allowed' | 'last_owner' };

export type RemoveMemberOutcome = 'removed' | 'not_found' | 'role_not_allowed' | 'last_owner';

export type CreateInvitationOutcome =
  | { status: 'created'; invitation: Invitation }
  | { status: 'role_not_allowed' | 'already_member' | 'send_failed' };

export type AcceptInvitationOutcome =
  | { status: 'accepted'; organization: Organization }
  /** Unknown, expired, revoked or already used. */
  | { status: 'invalid' }
  /** Sent to another address than the signed-in user's. */
  | { status: 'email_mismatch'; invitedEmail: string };
