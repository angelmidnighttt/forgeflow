-- Integrations are tenant tables (docs/adr/ADR-0002): read and written only within the
-- organization of the tenant context.
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE integrations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integrations_tenant ON integrations
  USING (organization_id = forgeflow_current_organization_id())
  WITH CHECK (organization_id = forgeflow_current_organization_id());
--> statement-breakpoint
ALTER TABLE integration_secrets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE integration_secrets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integration_secrets_tenant ON integration_secrets
  USING (organization_id = forgeflow_current_organization_id())
  WITH CHECK (organization_id = forgeflow_current_organization_id());
--> statement-breakpoint
-- A stored secret is never rewritten by the api: it adds versions and may only mark one revoked.
-- Rewrapping data keys under a new KEK (npm run secrets:rewrap) runs as the owner.
REVOKE UPDATE, DELETE, TRUNCATE ON integration_secrets FROM forgeflow_app;
--> statement-breakpoint
GRANT UPDATE (revoked_at) ON integration_secrets TO forgeflow_app;
