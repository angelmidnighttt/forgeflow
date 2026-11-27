import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sqlList, timestamptz } from './columns.js';
import { integrations } from './integrations.js';
import { organizations } from './tenancy.js';

/**
 * - pending: waiting for a worker (from available_at on);
 * - processing: claimed by a worker until locked_until (then any worker may claim it again);
 * - done: handled;
 * - dead: failed too many times, or cannot be handled; an admin may send it back to pending.
 */
export const OUTBOX_STATUSES = ['pending', 'processing', 'done', 'dead'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/**
 * Work to do after a transaction commits (transactional outbox, docs/adr/ADR-0003): the row is
 * written in the same transaction as the change that calls for it, so it exists exactly when
 * the change does, and a worker carries it out at least once. Handlers are idempotent.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Null for events no organization owns yet (a webhook from an installation not linked). */
    organizationId: uuid().references(() => organizations.id, { onDelete: 'cascade' }),
    /** What to do: `github.webhook`… */
    topic: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    status: text().$type<OutboxStatus>().notNull().default('pending'),
    /** Claims so far; each claim counts, so a worker that keeps crashing ends in dead. */
    attempts: integer().notNull().default(0),
    availableAt: timestamptz()
      .notNull()
      .default(sql`clock_timestamp()`),
    /** Fencing token of the current claim: only its holder may complete or fail the event. */
    lockToken: uuid(),
    lockedUntil: timestamptz(),
    lastError: text(),
    createdAt: timestamptz()
      .notNull()
      .default(sql`clock_timestamp()`),
    processedAt: timestamptz(),
  },
  (t) => [
    index('outbox_events_claimable_idx')
      .on(t.availableAt)
      .where(sql`${t.status} IN ('pending', 'processing')`),
    index('outbox_events_organization_status_idx').on(t.organizationId, t.status),
    check('outbox_events_status_check', sql`${t.status} IN (${sqlList(OUTBOX_STATUSES)})`),
  ],
);

/**
 * Every webhook received, once: the provider's delivery id is unique, so a redelivery is
 * recognized and adds nothing. The payload itself travels in the outbox event; this table is
 * the record of what arrived, for deduplication and the integrations page.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid().primaryKey().defaultRandom(),
    provider: text().notNull(),
    /** X-GitHub-Delivery. */
    deliveryId: text().notNull(),
    event: text().notNull(),
    action: text(),
    /** The provider's id of the installation it came from (GitHub App installation). */
    installationId: text(),
    /** Resolved from the installation when it is linked to an organization; null otherwise. */
    organizationId: uuid().references(() => organizations.id, { onDelete: 'cascade' }),
    integrationId: uuid().references(() => integrations.id, { onDelete: 'set null' }),
    outboxEventId: uuid().references(() => outboxEvents.id, { onDelete: 'set null' }),
    receivedAt: timestamptz()
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    uniqueIndex('webhook_deliveries_provider_delivery_key').on(t.provider, t.deliveryId),
    index('webhook_deliveries_integration_received_idx').on(t.integrationId, t.receivedAt.desc()),
  ],
);

export type OutboxEventRow = typeof outboxEvents.$inferSelect;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
