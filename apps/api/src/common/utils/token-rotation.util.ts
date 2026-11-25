import type { RefreshToken } from '@forgeflow/database';
import { TOKEN_POLICY } from '../constants/auth.constants.js';
import type { RotationDecision } from '../types/auth.types.js';

/** Expiry of a refresh token created at `now`: the idle limit, capped by the end of the sign-in. */
export function refreshTokenExpiry(now: Date, familyExpiresAt: Date): Date {
  return new Date(Math.min(now.getTime() + TOKEN_POLICY.refreshIdleMs, familyExpiresAt.getTime()));
}

/** What to do when a refresh token is presented at `now`; see RotationDecision. */
export function decideRotation(
  token: Pick<RefreshToken, 'expiresAt' | 'familyExpiresAt' | 'revokedAt' | 'revokedReason'>,
  now: Date,
): RotationDecision {
  if (token.revokedAt) {
    if (token.revokedReason !== 'rotated') return 'invalid';
    const sinceRotation = now.getTime() - token.revokedAt.getTime();
    return sinceRotation <= TOKEN_POLICY.refreshReuseGraceMs ? 'conflict' : 'reuse_detected';
  }
  if (now >= token.expiresAt || now >= token.familyExpiresAt) return 'invalid';
  return 'rotate';
}
