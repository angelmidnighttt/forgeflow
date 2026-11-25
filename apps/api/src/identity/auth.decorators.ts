import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { AuthContext, AuthenticatedRequest } from './auth-context.js';

export const IS_PUBLIC = 'forgeflow:public';
export const SKIP_CSRF = 'forgeflow:skip-csrf';

/** Route is reachable without signing in. Every other route requires a valid session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Route is never called with cookie auth (signed webhooks, API-token calls), so CSRF checks
 * do not apply. Never put this on a route that a signed-in browser calls.
 */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

/** The signed-in user and session. Only use on routes that are not @Public(). */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth) throw new Error('CurrentAuth used on a route without a session');
    return auth;
  },
);
