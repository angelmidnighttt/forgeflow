-- Repositories of GitHub integrations are tenant rows (docs/adr/ADR-0002).
ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE repositories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY repositories_tenant ON repositories
  USING (organization_id = forgeflow_current_organization_id())
  WITH CHECK (organization_id = forgeflow_current_organization_id());
