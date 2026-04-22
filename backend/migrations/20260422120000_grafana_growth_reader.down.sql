REVOKE SELECT ON TABLE public.client_error_logs FROM grafana_growth_reader;
REVOKE SELECT ON TABLE public.content_engagement_daily FROM grafana_growth_reader;
REVOKE SELECT ON TABLE public.growth_events FROM grafana_growth_reader;
REVOKE USAGE ON SCHEMA public FROM grafana_growth_reader;
REVOKE CONNECT ON DATABASE content_platform FROM grafana_growth_reader;

DROP ROLE IF EXISTS grafana_growth_reader;
