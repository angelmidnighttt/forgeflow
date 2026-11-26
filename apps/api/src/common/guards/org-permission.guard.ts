import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, type Permission } from '@forgeflow/contracts';
import { MembershipsService } from '../../modules/organizations/memberships.service.js';
import { REQUIRED_PERMISSION_KEY } from '../constants/metadata-keys.js';
import type { OrganizationRequest } from '../types/organization.types.js';
import { organizationNotFound, roleNotAllowed } from '../utils/organization-errors.util.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Global guard for @RequirePermission(). The organization comes from the route's `:orgId`, and
 * the caller's role from their membership in it, read fresh on every request (never from the
 * token or the body), so a removed member loses access at once.
 * - not a member (or no such organization, or a malformed id): 404, revealing nothing;
 * - a member whose role lacks the permission: 403.
 * Runs after JwtAuthGuard, so `req.auth` is set.
 */
@Injectable()
export class OrgPermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(MembershipsService) private readonly memberships: MembershipsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) return true;

    const req = context.switchToHttp().getRequest<OrganizationRequest>();
    const userId = req.auth?.userId;
    if (!userId) throw new Error('@RequirePermission needs a route that requires sign-in');
    const orgId = req.params.orgId;
    if (typeof orgId !== 'string' || !UUID_PATTERN.test(orgId)) throw organizationNotFound();

    const role = await this.memberships.findRole(orgId, userId);
    if (!role) throw organizationNotFound();
    if (!can(role, permission)) throw roleNotAllowed();

    req.membership = { organizationId: orgId, userId, role };
    return true;
  }
}
