import { timingSafeEqual } from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CSRF_HEADER, ErrorCode } from '@forgeflow/contracts';
import { API_ENV, type ApiEnv } from '../config/env.js';
import type { AuthenticatedRequest } from './auth-context.js';
import { SKIP_CSRF } from './auth.decorators.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Global guard, runs after SessionGuard. For state-changing requests it:
 * 1. rejects requests the browser marks as cross-site (Sec-Fetch-Site),
 * 2. rejects requests whose Origin is not the web app,
 * 3. when the request is signed in with the session cookie, requires X-CSRF-Token to equal
 *    the session's CSRF token (synchronizer token pattern).
 * SameSite=Lax on the cookie is a further layer; these checks do not rely on it.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.allowedOrigins = new Set([new URL(env.APP_ORIGIN).origin]);
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!UNSAFE_METHODS.has(req.method)) return true;

    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_CSRF, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    if (req.headers['sec-fetch-site'] === 'cross-site') {
      throw csrfFailure('Cross-site requests are not allowed.');
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !this.allowedOrigins.has(origin)) {
      throw csrfFailure('Request origin is not allowed.');
    }
    if (req.auth && !tokensMatch(req.headers[CSRF_HEADER], req.auth.session.csrfToken)) {
      throw csrfFailure('Missing or invalid CSRF token.');
    }
    return true;
  }
}

function csrfFailure(message: string): ForbiddenException {
  return new ForbiddenException({ code: ErrorCode.CsrfFailed, message });
}

function tokensMatch(received: unknown, expected: string): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
