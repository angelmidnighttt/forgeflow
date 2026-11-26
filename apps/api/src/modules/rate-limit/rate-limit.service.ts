import { Inject, Injectable } from '@nestjs/common';
import { rateLimitCounters, type DatabaseHandle } from '@forgeflow/database';
import { eq, sql } from 'drizzle-orm';
import { CLOCK, DATABASE } from '../../common/constants/injection-tokens.js';
import type { Clock } from '../../common/types/clock.types.js';
import type { RateLimitResult, RateLimitRule } from '../../common/types/rate-limit.types.js';

/**
 * Fixed-window rate limiting with counters in PostgreSQL (Redis replaces the storage in
 * Phase 11; callers do not change). Each hit is one upsert, so concurrent hits never lose a
 * count and the decision needs no lock.
 */
@Injectable()
export class RateLimitService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  /** Counts one hit for `subject` under `rule` and says whether it is within the limit. */
  async hit(rule: RateLimitRule, subject: string): Promise<RateLimitResult> {
    const now = this.now();
    const windowEnd = new Date(now.getTime() + rule.windowMs);
    // A counter whose window has ended starts over at 1 with a new window.
    const expired = sql`${rateLimitCounters.expiresAt} <= ${now}`;
    const [row] = await this.database.db
      .insert(rateLimitCounters)
      .values({ key: keyOf(rule, subject), hits: 1, windowStartedAt: now, expiresAt: windowEnd })
      .onConflictDoUpdate({
        target: rateLimitCounters.key,
        set: {
          hits: sql`case when ${expired} then 1 else ${rateLimitCounters.hits} + 1 end`,
          windowStartedAt: sql`case when ${expired} then ${now} else ${rateLimitCounters.windowStartedAt} end`,
          expiresAt: sql`case when ${expired} then ${windowEnd} else ${rateLimitCounters.expiresAt} end`,
        },
      })
      .returning({ hits: rateLimitCounters.hits, expiresAt: rateLimitCounters.expiresAt });
    if (!row) throw new Error('Rate limit upsert returned no row');

    return {
      allowed: row.hits <= rule.limit,
      hits: row.hits,
      retryAfterSeconds: Math.max(1, Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000)),
    };
  }

  /** Starts the count for `subject` over, e.g. after a successful login. */
  async reset(rule: RateLimitRule, subject: string): Promise<void> {
    await this.database.db
      .delete(rateLimitCounters)
      .where(eq(rateLimitCounters.key, keyOf(rule, subject)));
  }
}

function keyOf(rule: RateLimitRule, subject: string): string {
  return `${rule.name}:${subject}`;
}
