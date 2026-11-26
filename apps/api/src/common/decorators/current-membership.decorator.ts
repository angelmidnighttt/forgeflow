import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { MembershipContext, OrganizationRequest } from '../types/organization.types.js';

/** The caller's membership in the route's organization. Only on routes with @RequirePermission(). */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, context: ExecutionContext): MembershipContext => {
    const membership = context.switchToHttp().getRequest<OrganizationRequest>().membership;
    if (!membership)
      throw new Error('CurrentMembership used on a route without @RequirePermission');
    return membership;
  },
);
