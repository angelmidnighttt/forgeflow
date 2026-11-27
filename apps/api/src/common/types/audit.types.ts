import type { AuditAction } from '@forgeflow/contracts';

/** Who performs an audited action and from where. Built from the request by @CurrentActor(). */
export interface AuditActor {
  userId: string;
  ipAddress: string | null;
  /** The request's X-Request-Id, to find its log lines. */
  requestId: string | null;
}

export type AuditTargetType =
  'organization' | 'user' | 'invitation' | 'project' | 'environment' | 'integration';

/** One entry to add to an organization's audit trail. */
export interface AuditEntry {
  organizationId: string;
  /** 'system' for what ForgeFlow does on its own (workers, from Phase 2 on). */
  actor: AuditActor | 'system';
  action: AuditAction;
  target?: { type: AuditTargetType; id: string };
  /** What a reader needs to understand the entry later: names, roles before and after. */
  metadata?: Record<string, unknown>;
}
