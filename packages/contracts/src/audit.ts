import { z } from 'zod';

/**
 * The actions the audit trail records, as `<thing>.<event>`. Entries keep the action as text,
 * so the web app also shows actions added later (with a generic description).
 */
export const AUDIT_ACTIONS = [
  'organization.created',
  'organization.renamed',
  'member.role_changed',
  'member.removed',
  'member.left',
  'invitation.created',
  'invitation.revoked',
  'invitation.accepted',
  'project.created',
  'project.renamed',
  'environment.created',
  'environment.renamed',
  'environment.protected',
  'environment.unprotected',
  'integration.created',
  'integration.secret_rotated',
  'integration.secret_revoked',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_LOG_PAGE_SIZE = 50;
export const AUDIT_LOG_MAX_PAGE_SIZE = 100;

/** One entry of an organization's audit trail. */
export const auditLogEntrySchema = z.object({
  id: z.uuid(),
  action: z.string(),
  /** `id` is null for the system, and for a user whose account no longer exists. */
  actor: z.object({
    type: z.enum(['user', 'system']),
    id: z.uuid().nullable(),
    name: z.string().nullable(),
    email: z.string().nullable(),
  }),
  target: z.object({ type: z.string(), id: z.string() }).nullable(),
  /** Details of the action: names, emails, roles before and after. Never secrets. */
  metadata: z.record(z.string(), z.unknown()),
  ipAddress: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

/** GET /api/v1/organizations/:orgId/audit-logs: newest first. */
export const auditLogPageSchema = z.object({
  entries: z.array(auditLogEntrySchema),
  /** Pass as `cursor` for the next (older) page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type AuditLogPage = z.infer<typeof auditLogPageSchema>;

/** Query of GET /api/v1/organizations/:orgId/audit-logs. */
export const auditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(AUDIT_LOG_MAX_PAGE_SIZE).default(AUDIT_LOG_PAGE_SIZE),
  cursor: z.string().min(1).max(200).optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
