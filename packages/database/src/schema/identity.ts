import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const timestamptz = () => timestamp({ withTimezone: true, mode: 'date' });

/**
 * People who can sign in. Not tenant-scoped: one user can belong to many organizations,
 * so access to this table goes through the identity module, never through tenant queries.
 */
export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Stored lowercased; the index below also enforces uniqueness case-insensitively. */
    email: text().notNull(),
    name: text(),
    /** argon2id hash; null for accounts that only sign in through OAuth. */
    passwordHash: text(),
    emailVerifiedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('users_email_lower_key').on(sql`lower(${t.email})`)],
);

/**
 * Server-side sessions. The cookie carries a random token; only its SHA-256 hash is stored,
 * so a copy of this table cannot be used to sign in.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull(),
    /** Synchronizer CSRF token; the browser sends it back in the X-CSRF-Token header. */
    csrfToken: text().notNull(),
    userAgent: text(),
    ipAddress: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    lastUsedAt: timestamptz().notNull().defaultNow(),
    /** Idle expiry: moved forward while the session is used, never past absoluteExpiresAt. */
    expiresAt: timestamptz().notNull(),
    absoluteExpiresAt: timestamptz().notNull(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
