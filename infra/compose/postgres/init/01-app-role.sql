-- Development and CI only: the login role the api connects as (docs/adr/ADR-0002).
-- Production creates this role and its password through its own infrastructure (Phase 11).
--
-- Postgres runs this file when the volume is created. For an existing volume run
-- `npm run db:app-role` (`npm run dev` does it on every start); CI runs it before migrating.
-- Safe to run repeatedly. Migrations grant the table privileges; this file only makes the
-- role able to log in.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'forgeflow_app') THEN
    CREATE ROLE forgeflow_app;
  END IF;
  -- Never a superuser and never BYPASSRLS: row-level security must apply to the api.
  ALTER ROLE forgeflow_app WITH LOGIN PASSWORD 'forgeflow_app'
    NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
END
$$;
