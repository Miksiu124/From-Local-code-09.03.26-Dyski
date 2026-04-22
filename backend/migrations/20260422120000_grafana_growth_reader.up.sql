-- Read-only DB user for Grafana (or any SQL client): analytics tables only.
-- Tables: growth_events, content_engagement_daily (rollups), client_error_logs (frontend errors).
-- After this migration runs, set a strong password once (as superuser / platform):
--   ALTER ROLE grafana_growth_reader WITH PASSWORD 'your-secret-here';
-- Grafana datasource (example):
--   postgresql://grafana_growth_reader:PASSWORD@HOST:5432/content_platform?sslmode=require
--
-- We intentionally do NOT grant SELECT on growth_events_excluding_admins: that view
-- joins users; least-privilege Grafana access should use growth_events and filter in SQL if needed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'grafana_growth_reader') THEN
    CREATE ROLE grafana_growth_reader WITH LOGIN
      NOSUPERUSER
      INHERIT
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION;
  END IF;
END
$$;

COMMENT ON ROLE grafana_growth_reader IS 'Grafana read-only: SELECT on growth_events, content_engagement_daily, client_error_logs. Set password with ALTER ROLE.';

GRANT CONNECT ON DATABASE content_platform TO grafana_growth_reader;

GRANT USAGE ON SCHEMA public TO grafana_growth_reader;

GRANT SELECT ON TABLE public.growth_events TO grafana_growth_reader;
GRANT SELECT ON TABLE public.content_engagement_daily TO grafana_growth_reader;
GRANT SELECT ON TABLE public.client_error_logs TO grafana_growth_reader;
