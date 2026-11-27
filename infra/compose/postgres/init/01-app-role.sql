-- The login role the api connects as (docs/adr/ADR-0002). Migrations create the role (without
-- login) and grant its table privileges; this file only lets it log in. Safe to run repeatedly.
--
-- The password is psql's FORGEFLOW_APP_DB_PASSWORD environment variable, or "forgeflow_app" when
-- it is unset (development and CI):
-- - development: Postgres runs this file when the volume is created; for an existing volume run
--   `npm run db:app-role` (`npm run dev` does it on every start);
-- - CI runs it before migrating;
-- - servers (infra/staging) run it on every deploy, with the password from the server's .env.
\getenv app_password FORGEFLOW_APP_DB_PASSWORD
\if :{?app_password}
\else
\set app_password forgeflow_app
\endif

SELECT 'CREATE ROLE forgeflow_app'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'forgeflow_app')
\gexec

-- Never a superuser and never BYPASSRLS: row-level security must apply to the api.
SELECT format(
  'ALTER ROLE forgeflow_app WITH LOGIN PASSWORD %L '
  'NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'app_password'
)
\gexec
