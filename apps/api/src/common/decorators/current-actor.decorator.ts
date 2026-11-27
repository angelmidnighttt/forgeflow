import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuditActor } from '../types/audit.types.js';
import type { AuthenticatedRequest } from '../types/auth.types.js';

/**
 * The signed-in caller as the actor of audited actions: user id, client IP (as resolved with
 * TRUST_PROXY) and request id. Only use on routes that are not @Public().
 */
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuditActor => {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.auth) throw new Error('CurrentActor used on a route without an access token');
    return {
      userId: req.auth.userId,
      ipAddress: req.ip ?? null,
      requestId: typeof req.id === 'string' ? req.id : null,
    };
  },
);
