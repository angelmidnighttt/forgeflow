import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@forgeflow/contracts';
import { REQUIRED_PERMISSION_KEY } from '../constants/metadata-keys.js';

/**
 * The route acts on the organization in its `:orgId` parameter and needs `permission` there
 * (see PERMISSIONS in @forgeflow/contracts). OrgPermissionGuard checks the caller's membership
 * and makes it available through @CurrentMembership().
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);
