const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const SESSION_POLICY = {
  /** Signed out after this long without any request. */
  idleTimeoutMs: 7 * DAY_MS,
  /** Signed out this long after signing in, however active the session is. */
  absoluteLifetimeMs: 30 * DAY_MS,
  /** Refresh last_used_at / expires_at at most this often, so not every request writes. */
  touchIntervalMs: HOUR_MS,
} as const;

/** Next idle expiry for a session used at `now`, capped by its absolute expiry. */
export function nextIdleExpiry(now: Date, absoluteExpiresAt: Date): Date {
  return new Date(
    Math.min(now.getTime() + SESSION_POLICY.idleTimeoutMs, absoluteExpiresAt.getTime()),
  );
}
