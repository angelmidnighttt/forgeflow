import { sql } from 'drizzle-orm';
import type pg from 'pg';

/**
 * Who a tenant-scoped transaction acts for. Row-level security policies read these two values
 * (docs/adr/ADR-0002): `organizationId` opens that organization's rows, `userId` opens the
 * user's own memberships (and the organizations they belong to). Either may be left out.
 */
export interface TenantContext {
  organizationId?: string;
  userId?: string;
}

/**
 * `SELECT set_config(...)` for a context. `true` makes the values local to the transaction, so
 * a pooled connection never carries them into the next one (also under PgBouncer transaction
 * pooling). An absent value is set to '' so that nothing from an outer setting leaks in.
 */
export function tenantContextStatement(context: TenantContext) {
  return sql`select set_config('app.organization_id', ${context.organizationId ?? ''}, true), set_config('app.user_id', ${context.userId ?? ''}, true)`;
}

/**
 * Whether the role behind `pool` ignores row-level security (superuser or BYPASSRLS). The api
 * must never connect as such a role: every tenant policy would silently stop applying.
 */
export async function roleBypassesRowLevelSecurity(pool: pg.Pool): Promise<boolean> {
  const result = await pool.query<{ bypasses: boolean }>(
    'SELECT rolsuper OR rolbypassrls AS bypasses FROM pg_roles WHERE rolname = current_user',
  );
  return result.rows[0]?.bypasses ?? false;
}
