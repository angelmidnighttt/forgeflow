/**
 * A fixed-window limit: at most `limit` hits per `windowMs` for one subject. `by` says what the
 * subject is when the rule is applied with @RateLimit(): the client IP or the signed-in user.
 * Rules keyed on something else (an email in the body) are applied by the service that has it.
 */
export interface RateLimitRule {
  /** Prefix of the counter key; unique per rule. */
  name: string;
  limit: number;
  windowMs: number;
  by: 'ip' | 'user' | 'custom';
}

export interface RateLimitResult {
  allowed: boolean;
  /** Hits in the current window, this one included. */
  hits: number;
  /** Seconds until the window ends and the count starts over. */
  retryAfterSeconds: number;
}
