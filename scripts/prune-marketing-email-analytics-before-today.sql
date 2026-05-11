-- One-off: trim marketing *analytics* so the admin dashboard starts from "today".
--
-- Host bez psql: odpal SQL z kontenera Postgres (nazwa jak w docker-compose: content-postgres):
--   cd /opt/contentvault   # katalog z repo
--   docker exec -i content-postgres psql -U platform -d content_platform -v ON_ERROR_STOP=1 < scripts/prune-marketing-email-analytics-before-today.sql
--
-- Gdy masz psql na hoście:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/prune-marketing-email-analytics-before-today.sql
--
-- 1) marketing_email_click_events — safe to delete old rows (only affects CTR / unique clickers).
-- 2) marketing_campaign_sends — OPTIONAL and DANGEROUS (see below). Commented out by default.

BEGIN;

-- Clicks tracked via /api/public/email-cta (no impact on send cooldowns).
DELETE FROM marketing_email_click_events
WHERE clicked_at < date_trunc('day', now());

-- ---------------------------------------------------------------------------
-- OPTIONAL — only uncomment if you accept breaking campaign guards:
--
--   • winback / starter / at-risk / social: NOT EXISTS uses recent rows for
--     cooldown; deleting sends can let the same user get mail again too soon.
--   • repeat_buyer_promo_v1: "once ever" uses ANY row for user+campaign;
--     deleting old rows can allow a second repeat-buyer mail + second promo.
--
-- DELETE FROM marketing_campaign_sends
-- WHERE sent_at < date_trunc('day', now());
-- ---------------------------------------------------------------------------

COMMIT;
