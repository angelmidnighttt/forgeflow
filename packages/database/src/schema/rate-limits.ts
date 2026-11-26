import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const timestamptz = () => timestamp({ withTimezone: true, mode: 'date' });

/**
 * Fixed-window counters for rate limits (`login-ip:203.0.113.7`, `login-fail:ann@example.com`).
 * Kept in PostgreSQL until Redis arrives (Phase 11); rows past `expires_at` are dead and are
 * reset on the next hit or removed by the retention job.
 */
export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    /** `<rule name>:<subject>`, e.g. an IP address, a user id or a normalized email. */
    key: text().primaryKey(),
    hits: integer().notNull(),
    windowStartedAt: timestamptz().notNull(),
    /** End of the current window. */
    expiresAt: timestamptz().notNull(),
  },
  (t) => [index('rate_limit_counters_expires_at_idx').on(t.expiresAt)],
);

export type RateLimitCounter = typeof rateLimitCounters.$inferSelect;
