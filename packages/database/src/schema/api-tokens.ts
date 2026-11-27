import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns.js';
import { users } from './identity.js';
import { projects } from './projects.js';
import { organizations } from './tenancy.js';

/** What an API token may do; a token of a project acts on that project only. */
export const API_TOKEN_SCOPES = ['deployments:write'] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

/**
 * Tokens a pipeline uses to call ForgeFlow for one project (the report API). Like every secret
 * token only the SHA-256 hash is stored; the token is shown once, when created.
 */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid().notNull(),
    projectId: uuid().notNull(),
    name: text().notNull(),
    tokenHash: text().notNull(),
    /** The token's first characters, to tell tokens apart in lists ("ffp_AbCd…"). */
    prefix: text().notNull(),
    scopes: text().array().$type<ApiTokenScope[]>().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
    lastUsedAt: timestamptz(),
    expiresAt: timestamptz(),
    revokedAt: timestamptz(),
  },
  (t) => [
    foreignKey({
      name: 'api_tokens_project_fkey',
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete('cascade'),
    uniqueIndex('api_tokens_token_hash_key').on(t.tokenHash),
    index('api_tokens_project_idx').on(t.organizationId, t.projectId),
  ],
);

/**
 * Idempotency-Key handling: the first request with a key in a scope stores what it was (hash of
 * the request) and what it made; a repeat gets the same resource back, a different request
 * under the same key is refused.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** What the key is for, e.g. "deployments.create:<projectId>". */
    scope: text().notNull(),
    key: text().notNull(),
    requestHash: text().notNull(),
    resourceId: uuid(),
    createdAt: timestamptz()
      .notNull()
      .default(sql`now()`),
  },
  (t) => [uniqueIndex('idempotency_keys_scope_key').on(t.organizationId, t.scope, t.key)],
);

export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
