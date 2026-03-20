-- ═══════════════════════════════════════════════════════════════════════════
-- Audit: folder angeljustxfree — baza danych
-- Sprawdza martwy kontent (bez miniatur, bez odczytu HLS)
-- Użycie: docker compose exec -T postgres psql -U platform -d content_platform < scripts/audit-angeljustxfree.sql
-- ═══════════════════════════════════════════════════════════════════════════

\echo '=== AUDYT angeljustxfree (baza danych) ==='
\echo ''

-- Model
SELECT id, name, folder_name, is_active, last_synced_at
FROM models WHERE folder_name = 'angeljustxfree';

\echo ''
\echo '--- Statystyki ogólne ---'

SELECT
  content_type,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE is_active = true AND is_hidden = false) AS visible,
  COUNT(*) FILTER (WHERE is_active = false OR is_hidden = true) AS hidden_or_inactive
FROM content_items ci
JOIN models m ON m.id = ci.model_id
WHERE m.folder_name = 'angeljustxfree'
GROUP BY content_type
ORDER BY content_type;

\echo ''
\echo '--- Martwy kontent: bez miniatury ---'
\echo '(PHOTO wymaga thumbnail_path; VIDEO może mieć fallback z hls_folder_path/_thumbnail.webp)'

-- PHOTO bez thumbnail_path = martwy (nie da się wyświetlić)
-- VIDEO bez thumbnail_path I bez hls_folder_path = martwy (brak fallbacku)
SELECT
  ci.content_type,
  ci.id,
  ci.unique_id,
  ci.thumbnail_path,
  ci.hls_master_path,
  ci.hls_folder_path,
  ci.is_active,
  ci.is_hidden
FROM content_items ci
JOIN models m ON m.id = ci.model_id
WHERE m.folder_name = 'angeljustxfree'
  AND (
    (ci.content_type = 'PHOTO' AND (ci.thumbnail_path IS NULL OR TRIM(ci.thumbnail_path) = ''))
    OR
    (ci.content_type = 'VIDEO' AND (ci.thumbnail_path IS NULL OR TRIM(ci.thumbnail_path) = '')
     AND (ci.hls_folder_path IS NULL OR TRIM(ci.hls_folder_path) = ''))
  )
ORDER BY ci.content_type, ci.created_at DESC
LIMIT 50;

\echo ''
\echo '--- Liczba martwych (bez miniatury) ---'

SELECT
  content_type,
  COUNT(*) AS dead_no_thumbnail
FROM content_items ci
JOIN models m ON m.id = ci.model_id
WHERE m.folder_name = 'angeljustxfree'
  AND (
    (ci.content_type = 'PHOTO' AND (ci.thumbnail_path IS NULL OR TRIM(ci.thumbnail_path) = ''))
    OR
    (ci.content_type = 'VIDEO' AND (ci.thumbnail_path IS NULL OR TRIM(ci.thumbnail_path) = '')
     AND (ci.hls_folder_path IS NULL OR TRIM(ci.hls_folder_path) = ''))
  )
GROUP BY content_type;

\echo ''
\echo '--- VIDEO bez odczytu (brak HLS) ---'

SELECT
  ci.id,
  ci.unique_id,
  ci.thumbnail_path,
  ci.hls_master_path,
  ci.hls_folder_path,
  ci.duration,
  ci.is_active
FROM content_items ci
JOIN models m ON m.id = ci.model_id
WHERE m.folder_name = 'angeljustxfree'
  AND ci.content_type = 'VIDEO'
  AND (ci.hls_master_path IS NULL OR TRIM(ci.hls_master_path) = '')
  AND (ci.hls_folder_path IS NULL OR TRIM(ci.hls_folder_path) = '')
ORDER BY ci.created_at DESC
LIMIT 50;

\echo ''
\echo '--- Liczba VIDEO bez HLS (nie da się odtworzyć) ---'

SELECT COUNT(*) AS video_no_hls
FROM content_items ci
JOIN models m ON m.id = ci.model_id
WHERE m.folder_name = 'angeljustxfree'
  AND ci.content_type = 'VIDEO'
  AND (ci.hls_master_path IS NULL OR TRIM(ci.hls_master_path) = '')
  AND (ci.hls_folder_path IS NULL OR TRIM(ci.hls_folder_path) = '');

\echo ''
\echo '--- Podsumowanie martwego kontentu ---'

WITH stats AS (
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE ci.content_type = 'PHOTO' AND (ci.thumbnail_path IS NULL OR TRIM(ci.thumbnail_path) = '')) AS photo_no_thumb,
    COUNT(*) FILTER (WHERE ci.content_type = 'VIDEO'
      AND (ci.hls_master_path IS NULL OR TRIM(ci.hls_master_path) = '')
      AND (ci.hls_folder_path IS NULL OR TRIM(ci.hls_folder_path) = '')) AS video_no_hls,
    COUNT(*) FILTER (WHERE ci.content_type = 'VIDEO'
      AND (ci.thumbnail_path IS NULL OR TRIM(ci.thumbnail_path) = '')
      AND (ci.hls_folder_path IS NULL OR TRIM(ci.hls_folder_path) = '')) AS video_no_thumb_no_hls
  FROM content_items ci
  JOIN models m ON m.id = ci.model_id
  WHERE m.folder_name = 'angeljustxfree'
)
SELECT
  total AS "Wszystkie content_items",
  photo_no_thumb AS "PHOTO bez miniatury",
  video_no_hls AS "VIDEO bez HLS (nie da się odtworzyć)",
  video_no_thumb_no_hls AS "VIDEO bez miniatury i bez HLS",
  ROUND(100.0 * (photo_no_thumb + video_no_thumb_no_hls) / NULLIF(total, 0), 1) AS "Procent martwy (bez miniatury)"
FROM stats;
