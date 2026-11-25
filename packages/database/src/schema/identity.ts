import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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

export const REFRESH_TOKEN_REVOKE_REASONS = ['rotated', 'logout', 'reuse_detected'] as const;
export type RefreshTokenRevokeReason = (typeof REFRESH_TOKEN_REVOKE_REASONS)[number];

/**
 * Refresh tokens. Access tokens are stateless JWTs; these long-lived tokens are what let a
 * browser get new ones, so they are stored (as SHA-256 hashes only) to make sign-out and theft
 * response possible. Every refresh replaces the token with a new one in the same family; a
 * replaced token that shows up again means it was stolen, and the whole family is revoked.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Shared by every token created by refreshing the same sign-in. */
    familyId: uuid().notNull(),
    tokenHash: text().notNull(),
    userAgent: text(),
    ipAddress: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    /** Idle limit of this token; never later than familyExpiresAt. */
    expiresAt: timestamptz().notNull(),
    /** Absolute limit of the sign-in: refreshing never extends past it. */
    familyExpiresAt: timestamptz().notNull(),
    revokedAt: timestamptz(),
    revokedReason: text().$type<RefreshTokenRevokeReason>(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_token_hash_key').on(t.tokenHash),
    index('refresh_tokens_family_id_idx').on(t.familyId),
    index('refresh_tokens_user_id_idx').on(t.userId),
    check(
      'refresh_tokens_revoked_reason_check',
      sql`${t.revokedReason} IS NULL OR ${t.revokedReason} IN ('rotated', 'logout', 'reuse_detected')`,
    ),
    check(
      'refresh_tokens_revoked_consistent_check',
      sql`(${t.revokedAt} IS NULL) = (${t.revokedReason} IS NULL)`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
