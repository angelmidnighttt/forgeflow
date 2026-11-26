import { canAssignRole, ORGANIZATION_ROLES, type OrganizationRole } from '@forgeflow/contracts';

/** How roles are called in the interface. */
export const ROLE_LABELS: Record<OrganizationRole, string> = {
  owner: 'Chủ sở hữu',
  admin: 'Quản trị viên',
  member: 'Thành viên',
  viewer: 'Người xem',
};

export const ROLE_DESCRIPTIONS: Record<OrganizationRole, string> = {
  owner: 'Toàn quyền, kể cả quản lý quản trị viên và chủ sở hữu khác.',
  admin: 'Quản lý organization, thành viên và người xem.',
  member: 'Làm việc trong organization.',
  viewer: 'Chỉ xem.',
};

/** The roles `actor` may give (by invitation or role change), highest first. */
export function assignableRoles(actor: OrganizationRole): OrganizationRole[] {
  return ORGANIZATION_ROLES.filter((role) => canAssignRole(actor, role));
}
