-- If you already ran 20260422120000_grafana_growth_reader.up.sql when it only granted
-- growth_events, apply this to add the other analytics tables. Idempotent: safe to re-run
-- after the main migration was updated to include all three (duplicate GRANT is fine).

GRANT SELECT ON TABLE public.content_engagement_daily TO grafana_growth_reader;
GRANT SELECT ON TABLE public.client_error_logs TO grafana_growth_reader;
