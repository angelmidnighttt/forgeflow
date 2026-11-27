import { z } from 'zod';

/**
 * Roles in an organization, highest first:
 * - owner: everything, including managing admins and other owners. An organization always has
 *   at least one.
 * - admin: manages the organization and its members and viewers.
 * - member: works in the organization's projects (later: deployments, incidents).
 * - viewer: read-only.
 */
export const ORGANIZATION_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export const organizationRoleSchema = z.enum(ORGANIZATION_ROLES);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

const ALL_ROLES = ORGANIZATION_ROLES;
const MANAGERS = ['owner', 'admin'] as const;

/**
 * Which roles may do what. The api checks it on every organization route; the web app reads it
 * to show only the actions the user can take. Actions on one member (change role, remove) also
 * need canManageMember / canAssignRole.
 */
export const PERMISSIONS = {
  'organization.read': ALL_ROLES,
  'organization.update': MANAGERS,
  'members.read': ALL_ROLES,
  'members.manage': MANAGERS,
  'invitations.manage': MANAGERS,
  'projects.read': ALL_ROLES,
  /** Create and rename projects; add and rename their environments. */
  'projects.manage': MANAGERS,
  /**
   * Protect or unprotect an environment. Separate from projects.manage because protection
   * decides who must approve changes to production (Phase 6).
   */
  'environments.protect': MANAGERS,
  /** The organization's audit trail. */
  'audit.read': MANAGERS,
} as const satisfies Record<string, readonly OrganizationRole[]>;
export type Permission = keyof typeof PERMISSIONS;

export function can(role: OrganizationRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly OrganizationRole[]).includes(role);
}

/**
 * Whether `actor` may change the role of, or remove, a member with role `target`. Owners manage
 * everyone (other owners included); admins manage members and viewers only, so an admin can
 * never demote or remove another admin or an owner.
 */
export function canManageMember(actor: OrganizationRole, target: OrganizationRole): boolean {
  if (actor === 'owner') return true;
  return actor === 'admin' && (target === 'member' || target === 'viewer');
}

/** Whether `actor` may give `role` to someone (by invitation or role change). */
export function canAssignRole(actor: OrganizationRole, role: OrganizationRole): boolean {
  if (actor === 'owner') return true;
  return actor === 'admin' && (role === 'member' || role === 'viewer');
}
