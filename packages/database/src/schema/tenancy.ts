import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sqlList, timestamptz } from './columns.js';
import { users } from './identity.js';

/** Roles in an organization, highest first (same list as ORGANIZATION_ROLES in contracts). */
export const ORGANIZATION_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/** A tenant: everything ForgeFlow manages (projects, deployments, incidents…) belongs to one. */
export const organizations = pgTable('organizations', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  createdAt: timestamptz().notNull().defaultNow(),
  updatedAt: timestamptz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Who belongs to an organization, with which role. A user has at most one membership per
 * organization. Access to an organization is decided by this table on every request, so
 * removing a membership takes effect immediately.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text().$type<OrganizationRole>().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('memberships_organization_user_key').on(t.organizationId, t.userId),
    index('memberships_user_id_idx').on(t.userId),
    check('memberships_role_check', sql`${t.role} IN (${sqlList(ORGANIZATION_ROLES)})`),
  ],
);

/**
 * Invitations to join an organization, sent by email. Like other emailed tokens only the
 * SHA-256 hash is stored. An invitation is pending until it is accepted, revoked or expires;
 * each email has at most one pending invitation per organization.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Stored lowercased; only a user signed in with this email can accept. */
    email: text().notNull(),
    role: text().$type<OrganizationRole>().notNull(),
    tokenHash: text().notNull(),
    invitedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
    expiresAt: timestamptz().notNull(),
    acceptedAt: timestamptz(),
    acceptedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamptz(),
  },
  (t) => [
    uniqueIndex('invitations_token_hash_key').on(t.tokenHash),
    uniqueIndex('invitations_pending_email_key')
      .on(t.organizationId, t.email)
      .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    check('invitations_role_check', sql`${t.role} IN (${sqlList(ORGANIZATION_ROLES)})`),
    check(
      'invitations_single_outcome_check',
      sql`${t.acceptedAt} IS NULL OR ${t.revokedAt} IS NULL`,
    ),
  ],
);

export type OrganizationRow = typeof organizations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;
