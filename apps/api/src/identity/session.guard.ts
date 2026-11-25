import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@forgeflow/contracts';
import type { Response } from 'express';
import type { AuthenticatedRequest } from './auth-context.js';
import { IS_PUBLIC } from './auth.decorators.js';
import { SessionCookies } from './session-cookies.js';
import { SessionService } from './session.service.js';

/**
 * Global guard. Resolves the session cookie into `req.auth` and rejects requests without a
 * valid session unless the route is @Public(). A stale or unknown cookie is cleared.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SessionCookies) private readonly cookies: SessionCookies,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();

    const token = this.cookies.readToken(req);
    if (token) {
      const auth = await this.sessions.validate(token);
      if (auth) req.auth = auth;
      else this.cookies.clear(http.getResponse<Response>());
    }

    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!req.auth && !isPublic) {
      throw new UnauthorizedException({
        code: ErrorCode.Unauthorized,
        message: 'Sign in to continue.',
      });
    }
    return true;
  }
}
