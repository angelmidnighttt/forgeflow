import { SetMetadata } from '@nestjs/common';
import { RATE_LIMIT_KEY } from '../constants/metadata-keys.js';
import type { RateLimitRule } from '../types/rate-limit.types.js';

/**
 * Limits how often a route can be called, per client IP or per signed-in user (the rule's
 * `by`). Every rule given must pass. Checked by RateLimitGuard after authentication.
 */
export const RateLimit = (...rules: Array<RateLimitRule & { by: 'ip' | 'user' }>) =>
  SetMetadata(RATE_LIMIT_KEY, rules);
