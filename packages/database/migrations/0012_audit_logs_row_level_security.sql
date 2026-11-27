-- The audit trail is a tenant table (docs/adr/ADR-0002) and append-only for the api: it may
-- read and add entries of the organization in its context, never change or remove one.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_logs_tenant_read ON audit_logs FOR SELECT
  USING (organization_id = forgeflow_current_organization_id());
--> statement-breakpoint
CREATE POLICY audit_logs_tenant_insert ON audit_logs FOR INSERT
  WITH CHECK (organization_id = forgeflow_current_organization_id());
--> statement-breakpoint
-- No UPDATE or DELETE policy would already make such statements match no row; without the
-- privilege as well, an attempt fails loudly instead. 0008's default privileges granted them.
-- Retention (Phase 10) runs as the owner.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM forgeflow_app;
