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
import { AccessTokenService } from '../../modules/auth/access-token.service.js';
import { BEARER_REALM } from '../constants/auth.constants.js';
import { IS_PUBLIC_KEY } from '../constants/metadata-keys.js';
import type { AccessTokenCheck, AuthenticatedRequest } from '../types/auth.types.js';

const BEARER_PATTERN = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;

/**
 * Global guard. Verifies `Authorization: Bearer <access token>` and puts the caller in
 * `req.auth`. Routes without @Public() reject requests that have no valid token; @Public()
 * routes treat a missing or bad token as an anonymous call. Cookies are never accepted here.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AccessTokenService) private readonly accessTokens: AccessTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const isPublic =
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;

    const header = req.headers.authorization;
    if (header === undefined) {
      if (isPublic) return true;
      throw reject(http.getResponse<Response>(), ErrorCode.Unauthorized, 'Sign in to continue.');
    }

    const match = BEARER_PATTERN.exec(header);
    const check: AccessTokenCheck = match?.[1]
      ? await this.accessTokens.verify(match[1])
      : { valid: false, reason: 'invalid' };
    if (check.valid) {
      req.auth = check.auth;
      return true;
    }
    if (isPublic) return true;

    const res = http.getResponse<Response>();
    if (check.reason === 'expired') {
      throw reject(
        res,
        ErrorCode.TokenExpired,
        'Access token expired. Refresh it and retry.',
        'invalid_token',
      );
    }
    throw reject(res, ErrorCode.Unauthorized, 'Invalid access token.', 'invalid_token');
  }
}

/** 401 with the WWW-Authenticate header RFC 6750 asks for. */
function reject(
  res: Response,
  code: string,
  message: string,
  error?: 'invalid_token',
): UnauthorizedException {
  res.setHeader(
    'WWW-Authenticate',
    error ? `Bearer realm="${BEARER_REALM}", error="${error}"` : `Bearer realm="${BEARER_REALM}"`,
  );
  return new UnauthorizedException({ code, message });
}
