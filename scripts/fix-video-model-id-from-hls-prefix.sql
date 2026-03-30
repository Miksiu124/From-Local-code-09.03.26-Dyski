-- Fix VIDEO rows where model_id does not match the R2 folder (first path segment of hls_folder_path).
-- Typical after R2 merge + path REPLACE in DB without re-import, or before ON CONFLICT fixed model_id.
--
-- 1) Podgląd (powinno pokryć się z ~liczbą „entries” z diagnostyki):
--    docker compose exec -T postgres psql -U platform -d content_platform -f scripts/fix-video-model-id-from-hls-prefix.sql
--    Najpierw uruchom tylko sekcję SELECT poniżej (do znacznika UPDATE).
--
-- 2) Potem odkomentuj / wykonaj UPDATE w osobnym wywołaniu.

-- ═══ DRY-RUN: kto zostanie poprawiony ═══
SELECT
  ci.id,
  ci.unique_id,
  om.folder_name AS obecny_model_folder,
  split_part(ci.hls_folder_path, '/', 1) AS folder_z_sciezki,
  m.folder_name AS docelowy_model_folder
FROM content_items ci
JOIN models om ON om.id = ci.model_id
JOIN models m ON m.folder_name = split_part(ci.hls_folder_path, '/', 1)
WHERE ci.content_type = 'VIDEO'
  AND ci.hls_folder_path IS NOT NULL
  AND TRIM(ci.hls_folder_path) <> ''
  AND ci.model_id IS DISTINCT FROM m.id
ORDER BY docelowy_model_folder, ci.unique_id;

-- ═══ AKTUALIZACJA (wykonaj po sprawdzeniu listy powyżej) ═══
-- BEGIN;
-- UPDATE content_items ci
-- SET model_id = m.id
-- FROM models m
-- WHERE ci.content_type = 'VIDEO'
--   AND ci.hls_folder_path IS NOT NULL
--   AND TRIM(ci.hls_folder_path) <> ''
--   AND m.folder_name = split_part(ci.hls_folder_path, '/', 1)
--   AND ci.model_id IS DISTINCT FROM m.id;
-- COMMIT;

-- ═══ Po UPDATE: powinno zwrócić 0 wierszy ═══
-- SELECT COUNT(*) AS nadal_zle
-- FROM content_items ci
-- JOIN models m ON m.id = ci.model_id
-- WHERE ci.content_type = 'VIDEO'
--   AND ci.hls_folder_path IS NOT NULL
--   AND TRIM(ci.hls_folder_path) <> ''
--   AND ci.hls_folder_path NOT LIKE m.folder_name || '/%';
