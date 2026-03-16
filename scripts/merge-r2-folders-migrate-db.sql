-- Migracja DB: merge folderów R2
-- Uruchom PO wykonaniu merge na R2 (scripts/merge-r2-folders.py)
-- UWAGA: Wykonaj backup przed uruchomieniem!
--   docker compose exec postgres pg_dump -U platform content_platform > backup_pre_merge.sql
--
-- Użycie: docker compose exec -T postgres psql -U platform -d content_platform < scripts/merge-r2-folders-migrate-db.sql

-- Kolejność: angelijustx -> angeljustx, potem angeljustx -> angeljustxfree

BEGIN;

-- Helper: usuwa content_items ze źródła, które by kolidowały z dest (ten sam unique_id po zamianie)
-- 1. emilia szymanska -> emiliaszymanska
DO $$
DECLARE
  src_id TEXT;
  dest_id TEXT;
  cnt INT;
  del_dup INT;
BEGIN
  SELECT id INTO src_id FROM models WHERE folder_name = 'emilia szymanska';
  SELECT id INTO dest_id FROM models WHERE folder_name = 'emiliaszymanska';
  IF src_id IS NULL THEN
    RAISE NOTICE 'Model emilia szymanska nie istnieje - pomijam';
  ELSIF dest_id IS NULL THEN
    RAISE EXCEPTION 'Model emiliaszymanska nie istnieje - utwórz go najpierw';
  ELSE
    -- Usuń duplikaty (dest ma już ten sam content - wygrywa dest)
    DELETE FROM content_items ci
    WHERE ci.model_id = src_id
    AND EXISTS (
      SELECT 1 FROM content_items ci2
      WHERE ci2.model_id = dest_id
      AND ci2.unique_id = REPLACE(ci.unique_id, 'emilia szymanska-', 'emiliaszymanska-')
    );
    GET DIAGNOSTICS del_dup = ROW_COUNT;
    IF del_dup > 0 THEN RAISE NOTICE '  Usunięto % duplikatów unique_id', del_dup; END IF;
    -- unique_id: zdjęcia mają format folderName-filename
    UPDATE content_items SET
      model_id = dest_id,
      thumbnail_path = REPLACE(COALESCE(thumbnail_path,''), 'emilia szymanska/', 'emiliaszymanska/'),
      hls_master_path = REPLACE(COALESCE(hls_master_path,''), 'emilia szymanska/', 'emiliaszymanska/'),
      hls_folder_path = REPLACE(COALESCE(hls_folder_path,''), 'emilia szymanska/', 'emiliaszymanska/'),
      source_video_path = REPLACE(COALESCE(source_video_path,''), 'emilia szymanska/', 'emiliaszymanska/'),
      unique_id = REPLACE(unique_id, 'emilia szymanska-', 'emiliaszymanska-')
    WHERE model_id = src_id;
    GET DIAGNOSTICS cnt = ROW_COUNT;
    UPDATE user_access SET model_id = dest_id WHERE model_id = src_id;
    UPDATE purchases SET model_id = dest_id WHERE model_id = src_id;
    DELETE FROM models WHERE id = src_id;
    RAISE NOTICE 'emilia szymanska -> emiliaszymanska: % content_items', cnt;
  END IF;
END $$;

-- 2. zuziapov -> bitchimacowsu
DO $$
DECLARE
  src_id TEXT;
  dest_id TEXT;
  cnt INT;
  del_dup INT;
BEGIN
  SELECT id INTO src_id FROM models WHERE folder_name = 'zuziapov';
  SELECT id INTO dest_id FROM models WHERE folder_name = 'bitchimacowsu';
  IF src_id IS NULL THEN RAISE NOTICE 'zuziapov nie istnieje - pomijam'; RETURN; END IF;
  IF dest_id IS NULL THEN RAISE EXCEPTION 'bitchimacowsu nie istnieje'; END IF;
  DELETE FROM content_items ci WHERE ci.model_id = src_id AND EXISTS (
    SELECT 1 FROM content_items ci2 WHERE ci2.model_id = dest_id
    AND ci2.unique_id = REPLACE(ci.unique_id, 'zuziapov-', 'bitchimacowsu-')
  );
  UPDATE content_items SET
    model_id = dest_id,
    thumbnail_path = REPLACE(COALESCE(thumbnail_path,''), 'zuziapov/', 'bitchimacowsu/'),
    hls_master_path = REPLACE(COALESCE(hls_master_path,''), 'zuziapov/', 'bitchimacowsu/'),
    hls_folder_path = REPLACE(COALESCE(hls_folder_path,''), 'zuziapov/', 'bitchimacowsu/'),
    source_video_path = REPLACE(COALESCE(source_video_path,''), 'zuziapov/', 'bitchimacowsu/'),
    unique_id = REPLACE(unique_id, 'zuziapov-', 'bitchimacowsu-')
  WHERE model_id = src_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  UPDATE user_access SET model_id = dest_id WHERE model_id = src_id;
  UPDATE purchases SET model_id = dest_id WHERE model_id = src_id;
  DELETE FROM models WHERE id = src_id;
  RAISE NOTICE 'zuziapov -> bitchimacowsu: % content_items', cnt;
END $$;

-- 3. abigaillutzvip -> abigaillutz
DO $$
DECLARE
  src_id TEXT;
  dest_id TEXT;
  cnt INT;
BEGIN
  SELECT id INTO src_id FROM models WHERE folder_name = 'abigaillutzvip';
  SELECT id INTO dest_id FROM models WHERE folder_name = 'abigaillutz';
  IF src_id IS NULL THEN RAISE NOTICE 'abigaillutzvip nie istnieje - pomijam'; RETURN; END IF;
  IF dest_id IS NULL THEN RAISE EXCEPTION 'abigaillutz nie istnieje'; END IF;
  DELETE FROM content_items ci WHERE ci.model_id = src_id AND EXISTS (
    SELECT 1 FROM content_items ci2 WHERE ci2.model_id = dest_id
    AND ci2.unique_id = REPLACE(ci.unique_id, 'abigaillutzvip-', 'abigaillutz-')
  );
  UPDATE content_items SET
    model_id = dest_id,
    thumbnail_path = REPLACE(COALESCE(thumbnail_path,''), 'abigaillutzvip/', 'abigaillutz/'),
    hls_master_path = REPLACE(COALESCE(hls_master_path,''), 'abigaillutzvip/', 'abigaillutz/'),
    hls_folder_path = REPLACE(COALESCE(hls_folder_path,''), 'abigaillutzvip/', 'abigaillutz/'),
    source_video_path = REPLACE(COALESCE(source_video_path,''), 'abigaillutzvip/', 'abigaillutz/'),
    unique_id = REPLACE(unique_id, 'abigaillutzvip-', 'abigaillutz-')
  WHERE model_id = src_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  UPDATE user_access SET model_id = dest_id WHERE model_id = src_id;
  UPDATE purchases SET model_id = dest_id WHERE model_id = src_id;
  DELETE FROM models WHERE id = src_id;
  RAISE NOTICE 'abigaillutzvip -> abigaillutz: % content_items', cnt;
END $$;

-- 4. alexbergvip -> alexberg
DO $$
DECLARE
  src_id TEXT;
  dest_id TEXT;
  cnt INT;
BEGIN
  SELECT id INTO src_id FROM models WHERE folder_name = 'alexbergvip';
  SELECT id INTO dest_id FROM models WHERE folder_name = 'alexberg';
  IF src_id IS NULL THEN RAISE NOTICE 'alexbergvip nie istnieje - pomijam'; RETURN; END IF;
  IF dest_id IS NULL THEN RAISE EXCEPTION 'alexberg nie istnieje'; END IF;
  DELETE FROM content_items ci WHERE ci.model_id = src_id AND EXISTS (
    SELECT 1 FROM content_items ci2 WHERE ci2.model_id = dest_id
    AND ci2.unique_id = REPLACE(ci.unique_id, 'alexbergvip-', 'alexberg-')
  );
  UPDATE content_items SET
    model_id = dest_id,
    thumbnail_path = REPLACE(COALESCE(thumbnail_path,''), 'alexbergvip/', 'alexberg/'),
    hls_master_path = REPLACE(COALESCE(hls_master_path,''), 'alexbergvip/', 'alexberg/'),
    hls_folder_path = REPLACE(COALESCE(hls_folder_path,''), 'alexbergvip/', 'alexberg/'),
    source_video_path = REPLACE(COALESCE(source_video_path,''), 'alexbergvip/', 'alexberg/'),
    unique_id = REPLACE(unique_id, 'alexbergvip-', 'alexberg-')
  WHERE model_id = src_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  UPDATE user_access SET model_id = dest_id WHERE model_id = src_id;
  UPDATE purchases SET model_id = dest_id WHERE model_id = src_id;
  DELETE FROM models WHERE id = src_id;
  RAISE NOTICE 'alexbergvip -> alexberg: % content_items', cnt;
END $$;

-- 5. angelijustx -> angeljustx (najpierw)
DO $$
DECLARE
  src_id TEXT;
  dest_id TEXT;
  cnt INT;
BEGIN
  SELECT id INTO src_id FROM models WHERE folder_name = 'angelijustx';
  SELECT id INTO dest_id FROM models WHERE folder_name = 'angeljustx';
  IF src_id IS NULL THEN RAISE NOTICE 'angelijustx nie istnieje - pomijam'; RETURN; END IF;
  IF dest_id IS NULL THEN RAISE EXCEPTION 'angeljustx nie istnieje'; END IF;
  DELETE FROM content_items ci WHERE ci.model_id = src_id AND EXISTS (
    SELECT 1 FROM content_items ci2 WHERE ci2.model_id = dest_id
    AND ci2.unique_id = REPLACE(ci.unique_id, 'angelijustx-', 'angeljustx-')
  );
  UPDATE content_items SET
    model_id = dest_id,
    thumbnail_path = REPLACE(COALESCE(thumbnail_path,''), 'angelijustx/', 'angeljustx/'),
    hls_master_path = REPLACE(COALESCE(hls_master_path,''), 'angelijustx/', 'angeljustx/'),
    hls_folder_path = REPLACE(COALESCE(hls_folder_path,''), 'angelijustx/', 'angeljustx/'),
    source_video_path = REPLACE(COALESCE(source_video_path,''), 'angelijustx/', 'angeljustx/'),
    unique_id = REPLACE(unique_id, 'angelijustx-', 'angeljustx-')
  WHERE model_id = src_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  UPDATE user_access SET model_id = dest_id WHERE model_id = src_id;
  UPDATE purchases SET model_id = dest_id WHERE model_id = src_id;
  DELETE FROM models WHERE id = src_id;
  RAISE NOTICE 'angelijustx -> angeljustx: % content_items', cnt;
END $$;

-- 6. angeljustx -> angeljustxfree (potem)
DO $$
DECLARE
  src_id TEXT;
  dest_id TEXT;
  cnt INT;
BEGIN
  SELECT id INTO src_id FROM models WHERE folder_name = 'angeljustx';
  SELECT id INTO dest_id FROM models WHERE folder_name = 'angeljustxfree';
  IF src_id IS NULL THEN RAISE NOTICE 'angeljustx nie istnieje - pomijam'; RETURN; END IF;
  IF dest_id IS NULL THEN RAISE EXCEPTION 'angeljustxfree nie istnieje'; END IF;
  DELETE FROM content_items ci WHERE ci.model_id = src_id AND EXISTS (
    SELECT 1 FROM content_items ci2 WHERE ci2.model_id = dest_id
    AND ci2.unique_id = REPLACE(ci.unique_id, 'angeljustx-', 'angeljustxfree-')
  );
  UPDATE content_items SET
    model_id = dest_id,
    thumbnail_path = REPLACE(COALESCE(thumbnail_path,''), 'angeljustx/', 'angeljustxfree/'),
    hls_master_path = REPLACE(COALESCE(hls_master_path,''), 'angeljustx/', 'angeljustxfree/'),
    hls_folder_path = REPLACE(COALESCE(hls_folder_path,''), 'angeljustx/', 'angeljustxfree/'),
    source_video_path = REPLACE(COALESCE(source_video_path,''), 'angeljustx/', 'angeljustxfree/'),
    unique_id = REPLACE(unique_id, 'angeljustx-', 'angeljustxfree-')
  WHERE model_id = src_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  UPDATE user_access SET model_id = dest_id WHERE model_id = src_id;
  UPDATE purchases SET model_id = dest_id WHERE model_id = src_id;
  DELETE FROM models WHERE id = src_id;
  RAISE NOTICE 'angeljustx -> angeljustxfree: % content_items', cnt;
END $$;

COMMIT;
