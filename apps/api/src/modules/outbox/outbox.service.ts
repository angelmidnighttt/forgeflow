import { Inject, Injectable } from '@nestjs/common';
import type { OutboxEvent } from '@forgeflow/contracts';
import {
  outboxEvents,
  type DatabaseHandle,
  type DbExecutor,
  type OutboxEventRow,
} from '@forgeflow/database';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DATABASE } from '../../common/constants/injection-tokens.js';
import type { AuditActor } from '../../common/types/audit.types.js';
import type { ClaimedOutboxEvent } from '../../common/types/outbox.types.js';
import { AuditService } from '../audit/audit.service.js';

/** The NOTIFY channel that wakes workers when an event is enqueued. */
export const OUTBOX_CHANNEL = 'forgeflow_outbox';

interface ClaimedRow extends Record<string, unknown> {
  id: string;
  organization_id: string | null;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
  lock_token: string;
}

/**
 * The transactional outbox (docs/adr/ADR-0003). Producers enqueue inside their own transaction;
 * workers claim, complete and fail events through the system functions of migration 0016, since
 * they serve every organization; tenants read and retry their own dead events under RLS.
 */
@Injectable()
export class OutboxService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Adds an event within `tx` (the producer's transaction and tenant context) and wakes workers. */
  async enqueue(
    tx: DbExecutor,
    event: { organizationId: string; topic: string; payload: Record<string, unknown> },
  ): Promise<string> {
    const [row] = await tx.insert(outboxEvents).values(event).returning({ id: outboxEvents.id });
    if (!row) throw new Error('Outbox insert returned no row');
    // Delivered at commit, so a worker never wakes before the event is visible.
    await tx.execute(sql`select pg_notify(${OUTBOX_CHANNEL}, ${event.topic})`);
    return row.id;
  }

  /** Claims up to `limit` due events among `topics` (those the caller has handlers for). */
  async claim(
    topics: readonly string[],
    limit: number,
    leaseSeconds: number,
  ): Promise<ClaimedOutboxEvent[]> {
    const result = await this.database.db.execute<ClaimedRow>(
      sql`select * from forgeflow_claim_outbox_events(${`{${topics.join(',')}}`}::text[], ${limit}, ${leaseSeconds})`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      topic: row.topic,
      payload: row.payload,
      attempts: row.attempts,
      lockToken: row.lock_token,
    }));
  }

  /** False when the claim is no longer this caller's (its lease ran out and another took over). */
  async complete(event: Pick<ClaimedOutboxEvent, 'id' | 'lockToken'>): Promise<boolean> {
    const result = await this.database.db.execute<{ done: boolean }>(
      sql`select forgeflow_complete_outbox_event(${event.id}, ${event.lockToken}) as done`,
    );
    return result.rows[0]?.done === true;
  }

  /** Extends the leases of the claims among `events` the caller still holds; returns how many. */
  async renew(
    events: ReadonlyArray<Pick<ClaimedOutboxEvent, 'id' | 'lockToken'>>,
    leaseSeconds: number,
  ): Promise<number> {
    if (events.length === 0) return 0;
    const ids = `{${events.map((event) => event.id).join(',')}}`;
    const tokens = `{${events.map((event) => event.lockToken).join(',')}}`;
    const result = await this.database.db.execute<{ renewed: number }>(
      sql`select forgeflow_renew_outbox_leases(${ids}::uuid[], ${tokens}::uuid[], ${leaseSeconds}) as renewed`,
    );
    return Number(result.rows[0]?.renewed ?? 0);
  }

  /** `retryAt` null gives the event up (dead). */
  async fail(
    event: Pick<ClaimedOutboxEvent, 'id' | 'lockToken'>,
    error: string,
    retryAt: Date | null,
  ): Promise<boolean> {
    const result = await this.database.db.execute<{ failed: boolean }>(
      sql`select forgeflow_fail_outbox_event(${event.id}, ${event.lockToken}, ${error}, ${
        retryAt ? retryAt.toISOString() : null
      }::timestamptz) as failed`,
    );
    return result.rows[0]?.failed === true;
  }

  /** The organization's dead events, newest first. */
  async listDead(organizationId: string, limit = 50): Promise<OutboxEvent[]> {
    const rows = await this.database.withTenant({ organizationId }, (tx) =>
      tx
        .select()
        .from(outboxEvents)
        .where(
          and(eq(outboxEvents.organizationId, organizationId), eq(outboxEvents.status, 'dead')),
        )
        .orderBy(desc(outboxEvents.createdAt))
        .limit(limit),
    );
    return rows.map(toOutboxEvent);
  }

  /** Sends a dead event back to pending with a fresh count of attempts; false if it is not dead. */
  async retry(actor: AuditActor, organizationId: string, eventId: string): Promise<boolean> {
    return this.database.withTenant({ organizationId }, async (tx) => {
      const [row] = await tx
        .update(outboxEvents)
        .set({ status: 'pending', attempts: 0, availableAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(outboxEvents.organizationId, organizationId),
            eq(outboxEvents.id, eventId),
            eq(outboxEvents.status, 'dead'),
          ),
        )
        .returning({ id: outboxEvents.id, topic: outboxEvents.topic });
      if (!row) return false;
      await tx.execute(sql`select pg_notify(${OUTBOX_CHANNEL}, ${row.topic})`);
      await this.audit.record(tx, {
        organizationId,
        actor,
        action: 'outbox_event.retried',
        target: { type: 'outbox_event', id: eventId },
        metadata: { topic: row.topic },
      });
      return true;
    });
  }
}

export function toOutboxEvent(row: OutboxEventRow): OutboxEvent {
  const payload = row.payload;
  return {
    id: row.id,
    topic: row.topic,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    summary: typeof payload.event === 'string' ? payload.event : null,
    createdAt: row.createdAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
  };
}
