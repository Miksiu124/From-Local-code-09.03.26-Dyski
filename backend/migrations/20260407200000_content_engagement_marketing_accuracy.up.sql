-- Marketing accuracy:
-- 1) content_detail_view — pełny widok treści (overlay / strona / ulubione), nie tylko klik w siatkę.
-- 2) video_engagement — suma z watch_delta_sec (wielokrotne flush bez podwajania czasu); engagement_sessions tylko przy flush_kind=final lub legacy.

ALTER TABLE content_engagement_daily
  ADD COLUMN IF NOT EXISTS detail_views BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION trg_growth_events_bump_content_engagement_daily()
RETURNS TRIGGER AS $$
DECLARE
  v_cid TEXT;
  v_bucket DATE;
  v_admin BOOLEAN;
  v_ws DOUBLE PRECISION;
  v_sess BIGINT;
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

  ELSIF NEW.event_name = 'content_detail_view' THEN
    INSERT INTO content_engagement_daily AS d (content_item_id, bucket_date, detail_views)
    VALUES (v_cid, v_bucket, 1)
    ON CONFLICT (content_item_id, bucket_date) DO UPDATE
      SET detail_views = d.detail_views + 1, updated_at = now();

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
      IF NEW.props->>'watch_delta_sec' IS NOT NULL AND trim(NEW.props->>'watch_delta_sec') <> '' THEN
        v_ws := trim(NEW.props->>'watch_delta_sec')::double precision;
      ELSE
        v_ws := COALESCE(NULLIF(trim(COALESCE(NEW.props->>'watched_seconds', '')), '')::double precision, 0);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_ws := 0;
    END;
    v_sess := 0;
    IF COALESCE(trim(NEW.props->>'flush_kind'), '') = 'final'
       OR NEW.props->>'flush_kind' IS NULL THEN
      v_sess := 1;
    END IF;
    -- final przy delcie 0: czas już wysłany jako progress — tylko domknij licznik sesji
    IF v_ws <= 0 THEN
      IF v_sess >= 1 THEN
        INSERT INTO content_engagement_daily AS d (content_item_id, bucket_date, engagement_sessions)
        VALUES (v_cid, v_bucket, 1)
        ON CONFLICT (content_item_id, bucket_date) DO UPDATE
          SET engagement_sessions = d.engagement_sessions + 1, updated_at = now();
      END IF;
      RETURN NEW;
    END IF;
    INSERT INTO content_engagement_daily AS d (content_item_id, bucket_date, total_watch_sec, engagement_sessions)
    VALUES (v_cid, v_bucket, v_ws, v_sess)
    ON CONFLICT (content_item_id, bucket_date) DO UPDATE
      SET total_watch_sec = d.total_watch_sec + v_ws,
          engagement_sessions = d.engagement_sessions + v_sess,
          updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
