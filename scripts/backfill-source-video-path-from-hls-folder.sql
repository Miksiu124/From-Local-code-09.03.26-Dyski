-- ═══════════════════════════════════════════════════════════════════════════
-- DBeaver: backfill source_video_path = {hls_folder_path}.mp4 (tylko VIDEO)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1) Zaznacz i uruchom TYLKO blok poniżej (Ctrl+Enter) — podgląd liczby wierszy.
-- 2) Wyłącz Auto-commit w toolbarze DBeaver (ikona połączenia).
-- 3) Zaznacz blok BEGIN … UPDATE … COMMIT i uruchom jednym razem.
--    Albo: BEGIN + UPDATE, sprawdź "Updated rows", potem osobno COMMIT.
--
-- Jeśli coś pójdzie nie tak przed COMMIT: ROLLBACK;
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── KROK 1: podgląd (uruchom osobno) ───────────────────────────────────────

SELECT count(*) AS ile_zostanie_uzupełnionych
FROM content_items
WHERE content_type = 'VIDEO'
  AND hls_folder_path IS NOT NULL
  AND trim(hls_folder_path) <> ''
  AND (source_video_path IS NULL OR trim(source_video_path) = '');

-- Opcjonalnie — przykładowe wyliczone ścieżki (odkomentuj i uruchom):
/*
SELECT
  id,
  hls_folder_path,
  rtrim(trim(hls_folder_path), '/') || '.mp4' AS nowe_source_video_path
FROM content_items
WHERE content_type = 'VIDEO'
  AND hls_folder_path IS NOT NULL
  AND trim(hls_folder_path) <> ''
  AND (source_video_path IS NULL OR trim(source_video_path) = '')
LIMIT 30;
*/

-- ─── KROK 2: aktualizacja (Auto-commit OFF) ──────────────────────────────────

BEGIN;

UPDATE content_items
SET
  source_video_path = rtrim(trim(hls_folder_path), '/') || '.mp4',
  updated_at = now()
WHERE content_type = 'VIDEO'
  AND hls_folder_path IS NOT NULL
  AND trim(hls_folder_path) <> ''
  AND (source_video_path IS NULL OR trim(source_video_path) = '');

COMMIT;
