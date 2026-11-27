import { Inject, Injectable } from '@nestjs/common';
import type { AuditLogEntry, AuditLogPage, AuditLogQuery } from '@forgeflow/contracts';
import {
  auditLogs,
  users,
  type AuditLogRow,
  type DatabaseHandle,
  type DbExecutor,
} from '@forgeflow/database';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE } from '../../common/constants/injection-tokens.js';
import type { AuditEntry } from '../../common/types/audit.types.js';
import {
  after as afterPosition,
  decodeCursor,
  encodeCursor,
  preciseTimestamp,
} from '../../common/utils/cursor.util.js';

/**
 * The organizations' audit trails. `record` writes inside the caller's transaction, so an entry
 * exists exactly when its action happened: if either fails, both roll back.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  /** Adds `entry` within `tx`, the transaction (and tenant context) of the action it records. */
  async record(tx: DbExecutor, entry: AuditEntry): Promise<void> {
    const actor = entry.actor === 'system' ? null : entry.actor;
    await tx.insert(auditLogs).values({
      organizationId: entry.organizationId,
      actorType: actor ? 'user' : 'system',
      actorUserId: actor?.userId ?? null,
      action: entry.action,
      targetType: entry.target?.type ?? null,
      targetId: entry.target?.id ?? null,
      metadata: entry.metadata ?? {},
      ipAddress: actor?.ipAddress ?? null,
      requestId: actor?.requestId ?? null,
    });
  }

  /**
   * One page of the organization's trail, newest first. Pages are cut by position (created_at,
   * id) rather than by offset, so entries added meanwhile never shift or repeat a page.
   */
  async list(
    organizationId: string,
    query: AuditLogQuery,
  ): Promise<AuditLogPage | 'invalid_cursor'> {
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    if (after === null) return 'invalid_cursor';

    const rows = await this.database.withTenant({ organizationId }, (tx) =>
      tx
        .select({
          entry: auditLogs,
          actorName: users.name,
          actorEmail: users.email,
          // Full precision: a JavaScript Date would round created_at to milliseconds.
          at: preciseTimestamp(auditLogs.createdAt),
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorUserId))
        .where(
          and(
            eq(auditLogs.organizationId, organizationId),
            after ? afterPosition(auditLogs.createdAt, auditLogs.id, after) : undefined,
          ),
        )
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(query.limit + 1),
    );

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      entries: page.map((row) => toEntry(row.entry, row.actorName, row.actorEmail)),
      nextCursor:
        rows.length > query.limit && last ? encodeCursor({ at: last.at, id: last.entry.id }) : null,
    };
  }
}

function toEntry(
  row: AuditLogRow,
  actorName: string | null,
  actorEmail: string | null,
): AuditLogEntry {
  return {
    id: row.id,
    action: row.action,
    actor: { type: row.actorType, id: row.actorUserId, name: actorName, email: actorEmail },
    target:
      row.targetType !== null && row.targetId !== null
        ? { type: row.targetType, id: row.targetId }
        : null,
    metadata: row.metadata,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
  };
}
