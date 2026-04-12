-- Pre-aggregated per-content, per-UTC-day metrics (fed by growth_events + trigger).
-- Why not only growth_events? Admin "hotness" was full scans + JSON filters; this table gives
-- O(days × items) reads and the same rules as raw events (admin exclusion, event filters).
-- growth_events stays the append-only audit stream; this table is a derived cache.

CREATE TABLE IF NOT EXISTS content_engagement_daily (
  content_item_id      TEXT NOT NULL,
  bucket_date          DATE NOT NULL, -- UTC calendar day of event
  thumb_opens          BIGINT NOT NULL DEFAULT 0,
  first_plays          BIGINT NOT NULL DEFAULT 0,
  photo_first_views    BIGINT NOT NULL DEFAULT 0,
  total_watch_sec      DOUBLE PRECISION NOT NULL DEFAULT 0,
  engagement_sessions  BIGINT NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (content_item_id, bucket_date)
);

CREATE INDEX IF NOT EXISTS idx_content_engagement_daily_bucket
  ON content_engagement_daily (bucket_date DESC);

COMMENT ON TABLE content_engagement_daily IS
  'Derived from growth_events (content thumb/play/photo/watch). Kept in sync by trigger; use for admin content-performance.';

-- One-time backfill from existing events (run before trigger so we do not double-count).
INSERT INTO content_engagement_daily (
  content_item_id, bucket_date, thumb_opens, first_plays, photo_first_views,
  total_watch_sec, engagement_sessions, updated_at
)
SELECT
  trim(g.props->>'content_item_id'),
  (g.created_at AT TIME ZONE 'UTC')::date,
  COUNT(*) FILTER (WHERE g.event_name = 'content_thumb_click' AND g.props->>'outcome' = 'open')::bigint,
  COUNT(*) FILTER (WHERE g.event_name = 'first_play')::bigint,
  COUNT(*) FILTER (WHERE g.event_name = 'photo_view_first')::bigint,
  COALESCE(SUM(CASE WHEN g.event_name = 'video_engagement' THEN (g.props->>'watched_seconds')::double precision ELSE 0 END), 0),
  COUNT(*) FILTER (WHERE g.event_name = 'video_engagement')::bigint,
  max(g.created_at)
FROM growth_events g
LEFT JOIN users u ON u.id = g.user_id
WHERE (g.user_id IS NULL OR u.id IS NULL OR u.role IS DISTINCT FROM 'ADMIN'::user_role)
  AND g.props->>'content_item_id' IS NOT NULL
  AND length(trim(g.props->>'content_item_id')) >= 32
GROUP BY trim(g.props->>'content_item_id'), (g.created_at AT TIME ZONE 'UTC')::date;

-- Live updates: mirror InsertEvent rules (admin users do not bump metrics).
CREATE OR REPLACE FUNCTION trg_growth_events_bump_content_engagement_daily()
RETURNS TRIGGER AS $$
DECLARE
  v_cid TEXT;
  v_bucket DATE;
  v_admin BOOLEAN;
  v_ws DOUBLE PRECISION;
BEGIN
  v_cid := trim(NEW.props->>'content_item_id');
  IF v_cid IS NULL OR length(v_cid) < 32 THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NOT NULL THEN
    SELECT (u.role = 'ADMIN') INTO v_admin FROM users u WHERE u.id = NEW.user_id;
    IF COALESCE(v_admin, FALSE) THEN
      RETURN NEW;
    END IF;
  END IF;

  v_bucket := (NEW.created_at AT TIME ZONE 'UTC')::date;

  IF NEW.event_name = 'content_thumb_click' AND (NEW.props->>'outcome') = 'open' THEN
    INSERT INTO content_engagement_daily AS d (content_item_id, bucket_date, thumb_opens)
    VALUES (v_cid, v_bucket, 1)
    ON CONFLICT (content_item_id, bucket_date) DO UPDATE
      SET thumb_opens = d.thumb_opens + 1, updated_at = now();

  ELSIF NEW.event_name = 'first_play' THEN
    INSERT INTO content_engagement_daily AS d (content_item_id, bucket_date, first_plays)
    VALUES (v_cid, v_bucket, 1)
    ON CONFLICT (content_item_id, bucket_date) DO UPDATE
      SET first_plays = d.first_plays + 1, updated_at = now();

  ELSIF NEW.event_name = 'photo_view_first' THEN
    INSERT INTO content_engagement_daily AS d (content_item_id, bucket_date, photo_first_views)
    VALUES (v_cid, v_bucket, 1)
    ON CONFLICT (content_item_id, bucket_date) DO UPDATE
      SET photo_first_views = d.photo_first_views + 1, updated_at = now();

  ELSIF NEW.event_name = 'video_engagement' THEN
    BEGIN
      v_ws := COALESCE(NULLIF(trim(COALESCE(NEW.props->>'watched_seconds', '')), '')::double precision, 0);
    EXCEPTION WHEN OTHERS THEN
      v_ws := 0;
    END;
    INSERT INTO content_engagement_daily AS d (content_item_id, bucket_date, total_watch_sec, engagement_sessions)
    VALUES (v_cid, v_bucket, v_ws, 1)
    ON CONFLICT (content_item_id, bucket_date) DO UPDATE
      SET total_watch_sec = d.total_watch_sec + v_ws,
          engagement_sessions = d.engagement_sessions + 1,
          updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS growth_events_content_engagement_daily ON growth_events;
CREATE TRIGGER growth_events_content_engagement_daily
  AFTER INSERT ON growth_events
  FOR EACH ROW
  EXECUTE PROCEDURE trg_growth_events_bump_content_engagement_daily();
