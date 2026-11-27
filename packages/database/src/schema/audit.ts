import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { sqlList, timestamptz } from './columns.js';
import { users } from './identity.js';
import { organizations } from './tenancy.js';

/** Who did it: a person, or ForgeFlow itself (workers, from Phase 2 on). */
export const AUDIT_ACTOR_TYPES = ['user', 'system'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/**
 * The organization's audit trail: one row per sensitive action, written in the same transaction
 * as the action itself, so there is never a change without its entry or an entry without its
 * change. The api's role may only add and read rows (migration 0012): the trail is append-only.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    actorType: text().$type<AuditActorType>().notNull(),
    /** The user who acted; null for the system, or once that user's account is gone. */
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** What happened, as `<thing>.<event>`: `member.role_changed`, `environment.protected`… */
    action: text().notNull(),
    /** What it happened to, e.g. ('project', <id>); both set or both null. */
    targetType: text(),
    targetId: text(),
    /** Details needed to read the entry later (names, roles before and after). Never secrets. */
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text(),
    /** The X-Request-Id of the request, to find its log lines. */
    requestId: text(),
    /**
     * When the entry was written: clock_timestamp(), not now(), so that the entries of one
     * transaction (renamed, then protected) keep the order they were written in.
     */
    createdAt: timestamptz()
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    index('audit_logs_organization_created_idx').on(
      t.organizationId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('audit_logs_actor_user_id_idx').on(t.actorUserId),
    check('audit_logs_actor_type_check', sql`${t.actorType} IN (${sqlList(AUDIT_ACTOR_TYPES)})`),
    check('audit_logs_target_check', sql`(${t.targetType} IS NULL) = (${t.targetId} IS NULL)`),
  ],
);

export type AuditLogRow = typeof auditLogs.$inferSelect;
