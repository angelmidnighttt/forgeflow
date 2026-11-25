import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ErrorCode } from '@forgeflow/contracts';
import type { Request } from 'express';
import type { ApiEnv } from '../../config/env.js';
import { UNSAFE_METHODS } from '../constants/http.constants.js';
import { API_ENV } from '../constants/injection-tokens.js';

/**
 * Global CSRF guard. Access tokens travel in the Authorization header, which browsers never
 * attach on their own, so ordinary API calls cannot be forged. The refresh cookie can be, which
 * is why it is SameSite=Strict; as a second layer, every state-changing request that a browser
 * marks as cross-site (Sec-Fetch-Site) or that carries an Origin other than the web app is
 * refused. Server-to-server callers send no Origin and are unaffected.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.allowedOrigins = new Set([new URL(env.APP_ORIGIN).origin]);
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (!UNSAFE_METHODS.has(req.method)) return true;

    if (req.headers['sec-fetch-site'] === 'cross-site') {
      throw originRejected('Cross-site requests are not allowed.');
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !this.allowedOrigins.has(origin)) {
      throw originRejected('Request origin is not allowed.');
    }
    return true;
  }
}

function originRejected(message: string): ForbiddenException {
  return new ForbiddenException({ code: ErrorCode.OriginNotAllowed, message });
}
