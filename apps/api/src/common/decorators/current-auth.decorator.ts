import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthContext, AuthenticatedRequest } from '../types/auth.types.js';

/** The caller identified by the access token. Only use on routes that are not @Public(). */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth) throw new Error('CurrentAuth used on a route without an access token');
    return auth;
  },
);
