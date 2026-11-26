import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { RateLimitService } from '../../modules/rate-limit/rate-limit.service.js';
import { RATE_LIMIT_KEY } from '../constants/metadata-keys.js';
import type { AuthenticatedRequest } from '../types/auth.types.js';
import type { RateLimitRule } from '../types/rate-limit.types.js';
import { tooManyRequests } from '../utils/rate-limit.util.js';

/**
 * Global guard for @RateLimit(). Runs after JwtAuthGuard (so `req.auth` is known) and after
 * OriginGuard (so refused cross-site requests do not count). Per-IP rules use `req.ip`, which
 * honours TRUST_PROXY: behind a reverse proxy it must be set, or every client shares the
 * proxy's address and one counter.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RateLimitService) private readonly rateLimits: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const rules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rules?.length) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    for (const rule of rules) {
      const subject = rule.by === 'user' ? req.auth?.userId : req.ip;
      if (!subject) continue;
      const result = await this.rateLimits.hit(rule, subject);
      if (!result.allowed) {
        throw tooManyRequests(http.getResponse<Response>(), result.retryAfterSeconds);
      }
    }
    return true;
  }
}
