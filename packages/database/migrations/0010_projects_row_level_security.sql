-- Row-level security for projects and environments (docs/adr/ADR-0002), like the tenant tables
-- of 0008: read and write only within the organization of the tenant context. The api's role
-- already has its table privileges through 0008's default privileges.
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY projects_tenant ON projects
  USING (organization_id = forgeflow_current_organization_id())
  WITH CHECK (organization_id = forgeflow_current_organization_id());
--> statement-breakpoint
ALTER TABLE environments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE environments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY environments_tenant ON environments
  USING (organization_id = forgeflow_current_organization_id())
  WITH CHECK (organization_id = forgeflow_current_organization_id());
