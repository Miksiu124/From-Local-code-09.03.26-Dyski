DROP TRIGGER IF EXISTS growth_events_content_engagement_daily ON growth_events;
DROP FUNCTION IF EXISTS trg_growth_events_bump_content_engagement_daily();
DROP TABLE IF EXISTS content_engagement_daily;
