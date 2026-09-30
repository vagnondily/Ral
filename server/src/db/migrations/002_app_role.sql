-- The docker-compose "postgres" superuser (mems) is used only to run
-- migrations and the seed script. The API and worker processes connect as
-- this much more restricted role instead, so that Row-Level Security
-- (migration 001) is actually enforced — Postgres superusers and table
-- owners bypass RLS entirely, so running the app as the migration user
-- would silently defeat the tenant-isolation policies.
--
-- Change mems2_app_change_me in any non-local environment (see README).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mems2_app') THEN
    CREATE ROLE mems2_app LOGIN PASSWORD 'mems2_app_change_me' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

GRANT CONNECT ON DATABASE mems2_tpm TO mems2_app;
GRANT USAGE ON SCHEMA public TO mems2_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mems2_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mems2_app;
