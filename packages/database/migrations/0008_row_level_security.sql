-- Row-level security for the tenant tables (docs/adr/ADR-0002). Written by hand: drizzle-kit
-- does not manage roles, grants, FORCE ROW LEVEL SECURITY or SECURITY DEFINER functions.
-- Runs as the owner role (MIGRATION_DATABASE_URL), which owns the tables and bypasses RLS.

-- 1. The role the api connects as. Infrastructure gives it LOGIN and a password
--    (infra/compose/postgres/init/01-app-role.sql locally); here it only has to exist for the
--    grants. Never a superuser and never BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'forgeflow_app') THEN
    CREATE ROLE forgeflow_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO forgeflow_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO forgeflow_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO forgeflow_app;
--> statement-breakpoint
-- Tables and sequences that later migrations create get the same privileges.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO forgeflow_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO forgeflow_app;
--> statement-breakpoint

-- 2. The tenant context of the current transaction, set by withTenant() with
--    set_config(..., true). Once a transaction has set them, later reads on the same
--    connection return '' rather than NULL, hence NULLIF.
CREATE FUNCTION forgeflow_current_organization_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION forgeflow_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- 3. Policies. FORCE makes them apply to the table owner as well (it still passes, having
--    BYPASSRLS); the api's role is not the owner either way. No context: no rows.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The organization of the context: read and write.
CREATE POLICY organizations_tenant ON organizations
  USING (id = forgeflow_current_organization_id())
  WITH CHECK (id = forgeflow_current_organization_id());
--> statement-breakpoint
-- The organizations the user of the context belongs to: read only (the list of their orgs).
CREATE POLICY organizations_member_read ON organizations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = organizations.id AND m.user_id = forgeflow_current_user_id()
  ));
--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_tenant ON memberships
  USING (organization_id = forgeflow_current_organization_id())
  WITH CHECK (organization_id = forgeflow_current_organization_id());
--> statement-breakpoint
-- A user's own memberships in any organization: read only.
CREATE POLICY memberships_self_read ON memberships FOR SELECT
  USING (user_id = forgeflow_current_user_id());
--> statement-breakpoint
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invitations_tenant ON invitations
  USING (organization_id = forgeflow_current_organization_id())
  WITH CHECK (organization_id = forgeflow_current_organization_id());
--> statement-breakpoint

-- 4. The "system" path: narrow SECURITY DEFINER functions for requests that do not know their
--    organization yet. Each returns only what is needed to set the tenant context; everything
--    else then runs under RLS. They run as the owner (which bypasses RLS), so search_path is
--    pinned and only forgeflow_app may call them.

-- The organization of the invitation whose token hashes to p_token_hash (invitation links).
CREATE FUNCTION forgeflow_invitation_organization(p_token_hash text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT organization_id FROM public.invitations WHERE token_hash = p_token_hash $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION forgeflow_invitation_organization(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION forgeflow_invitation_organization(text) TO forgeflow_app;
