# Instrukcja: Merge folderów R2 z zachowaniem struktury

**Dla:** Senior Developer  
**Od:** Senior Product Manager  
**Data:** 2026-03-14

## Cel

Zmergować foldery na R2 zgodnie z mapowaniem poniżej. Folder źródłowy (A) jest usuwany po migracji. Folder docelowy (B) staje się jedynym źródłem treści dla danego modelu.

## Mapowanie merge (Folder A → Folder B)

| Folder źródłowy (A) | Folder docelowy (B) |
|--------------------|---------------------|
| emilia szymanska   | emiliaszymanska     |
| zuziapov           | bitchimacowsu       |
| abigaillutzvip     | abigaillutz        |
| alexbergvip        | alexberg           |
| angelijustx        | angeljustx         |
| angeljustx         | angeljustxfree     |

**Uwaga:** `angelijustx` → `angeljustxfree` i `angelijustx` jest celem dla `angelijustx`. Wykonaj merge w kolejności:
1. `angelijustx` → `angeljustx` (najpierw)
2. `angeljustx` → `angeljustxfree` (potem)

---

## Kontekst techniczny

### Struktura R2

- **Główny bucket:** treści modeli (filmy, zdjęcia)
- **Prefixy:** każdy model = folder = prefix, np. `emiliaszymanska/`, `bitchimacowsu/`
- **Ścieżki w content:**
  - Video: `{folder}/UNIQUE_ID_source/master-*.m3u8`, `{folder}/UNIQUE_ID_source/*.ts`
  - Photo: `{folder}/FILENAME.jpg`
  - Avatar/header: `avatars/{folder}_avatar.webp`, `avatars/{folder}_header.webp` lub `{folder}/avatar.jpg`

### Baza danych (PostgreSQL)

- **`models`**: `folder_name` (UNIQUE) – mapuje 1:1 na folder R2
- **`content_items`**: `model_id`, `thumbnail_path`, `hls_master_path`, `hls_folder_path`, `source_video_path` – ścieżki R2 zawierają prefix folderu
- **Powiązane tabele:** `purchases`, `user_access`, `favorites` – referencje przez `model_id`

### Codebase

- **API:** `/api/models/{folderName}/...` – slug = `folder_name`
- **Frontend:** `/models/[slug]` – slug = `folder_name`
- **Sitemap:** generuje URL-e na podstawie `folder_name`

---

## Szybki start (TL;DR)

```bash
# 1. Backup DB
docker compose exec postgres pg_dump -U platform content_platform > backup_pre_merge_$(date +%Y%m%d).sql

# 2. Merge R2 (dry-run najpierw!)
cd ContentManager
python scripts/merge-r2-folders.py --run-all --dry-run
python scripts/merge-r2-folders.py --run-all

# 3. Migracja DB
docker compose exec -T postgres psql -U platform -d content_platform < scripts/merge-r2-folders-migrate-db.sql

# 4. Usuń foldery źródłowe z R2 (PO migracji DB!)
python scripts/merge-r2-folders.py --delete-sources-only --dry-run  # najpierw dry-run
python scripts/merge-r2-folders.py --delete-sources-only

# 5. Weryfikacja: Sync R2 + Import w /admin/models
```

---

## Kroki wykonania

### 0. Przygotowanie

1. **Backup bazy danych** (na VPS):
   ```bash
   docker compose exec postgres pg_dump -U platform content_platform > backup_pre_merge_$(date +%Y%m%d).sql
   ```

2. **Klucze R2:** Użyj `.env` z VPS (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`). Alternatywnie klucze zostaną dostarczone osobno.

3. **Weryfikacja folderów w R2:**
   ```bash
   cd ContentManager
   python scripts/rename-r2-source-photos.py "" --list-prefixes
   ```
   Sprawdź, czy foldery źródłowe i docelowe istnieją. Zwróć uwagę na `emilia szymanska` – jeśli w R2 jest `emilia.szymanska` lub inna wersja, dostosuj mapowanie.

---

### 1. Merge na R2 (kopiowanie obiektów)

Dla każdej pary (A → B):

1. **Skopiuj wszystkie obiekty** z `A/` do `B/`:
   - Użyj `CopyObject` (S3 API) – nie pobieraj/uploaduj, tylko server-side copy
   - W przypadku kolizji (ten sam klucz w A i B): **zachowaj plik z B** (docelowy ma priorytet) lub dodaj suffix `_merged` dla plików z A

2. **Avatary/headery:** Jeśli `avatars/A_avatar.webp` istnieje a `avatars/B_avatar.webp` nie – skopiuj. W przeciwnym razie nie nadpisuj.

3. **Usuń folder A** dopiero po pomyślnym merge w DB (krok 3).

**Skrypt pomocniczy (Python/boto3):** Zobacz `scripts/merge-r2-folders.py` (do utworzenia – szablon poniżej).

---

### 2. Aktualizacja bazy danych

Dla każdej pary (A → B):

1. **Pobierz ID modeli:**
   ```sql
   SELECT id, folder_name FROM models WHERE folder_name IN ('A', 'B');
   ```

2. **Zaktualizuj `content_items`:**
   - Zmień `model_id` z ID modelu A na ID modelu B
   - Zaktualizuj ścieżki: zamień prefix `A/` na `B/` w `thumbnail_path`, `hls_master_path`, `hls_folder_path`, `source_video_path`
   - Dla `unique_id`: zdjęcia używają `folderName-filename` – zamień prefix w `unique_id` z `A-` na `B-` (uwaga: `unique_id` jest UNIQUE – może być konflikt; wtedy użyj `B-{random}` lub pomiń duplikaty)

3. **Zaktualizuj powiązane tabele:**
   - `user_access`: `model_id` A → B (gdzie `model_id = id_modelu_A`)
   - `purchases`: `model_id` A → B
   - `favorites`: przez `content_item_id` – nie wymaga zmiany (content_items już wskazują na model B)

4. **Usuń model A:**
   ```sql
   DELETE FROM models WHERE folder_name = 'A';
   ```
   (Cascade usunie ewentualne pozostałe powiązania; `user_access` i `purchases` już zaktualizowane)

**Przykładowy SQL (szablon):**
```sql
-- Dla pary emilia szymanska → emiliaszymanska
BEGIN;

WITH ids AS (
  SELECT 
    (SELECT id FROM models WHERE folder_name = 'emilia szymanska') AS src_id,
    (SELECT id FROM models WHERE folder_name = 'emiliaszymanska') AS dest_id
)
UPDATE content_items 
SET 
  model_id = (SELECT dest_id FROM ids),
  thumbnail_path = REPLACE(thumbnail_path, 'emilia szymanska/', 'emiliaszymanska/'),
  hls_master_path = REPLACE(hls_master_path, 'emilia szymanska/', 'emiliaszymanska/'),
  hls_folder_path = REPLACE(hls_folder_path, 'emilia szymanska/', 'emiliaszymanska/'),
  source_video_path = REPLACE(COALESCE(source_video_path, ''), 'emilia szymanska/', 'emiliaszymanska/')
WHERE model_id = (SELECT src_id FROM ids);

UPDATE user_access SET model_id = (SELECT dest_id FROM ids) WHERE model_id = (SELECT src_id FROM ids);
UPDATE purchases SET model_id = (SELECT dest_id FROM ids) WHERE model_id = (SELECT src_id FROM ids);

DELETE FROM models WHERE folder_name = 'emilia szymanska';

COMMIT;
```

**Uwaga dla `unique_id`:** Zdjęcia mają `unique_id` w formacie `folderName-filename`. Przy merge mogą powstać duplikaty (A-foto.jpg i B-foto.jpg). Rozwiąż to przed UPDATE:
- Albo nadaj unikalne ID (np. `B-foto_merged`)
- Albo usuń duplikaty z A, jeśli B ma już ten sam plik

---

### 3. Usunięcie folderu źródłowego z R2

Po pomyślnym merge w DB:

```bash
# Użyj skryptu lub AWS CLI do usunięcia wszystkich obiektów pod prefixem A/
```

---

### 4. Weryfikacja

1. **Sync R2:** W panelu admin (`/admin/models`) uruchom "Sync R2" – nie powinno pojawić się nic nowego ani błędów.
2. **Import:** Dla folderu docelowego (B) uruchom "Import from R2" – powinien wykryć ewentualne nowe pliki (jeśli były kolizje i nie skopiowano).
3. **Frontend:** Sprawdź `/models/emiliaszymanska`, `/models/bitchimacowsu` itd. – treści powinny się wyświetlać.
4. **Sitemap:** `/sitemap.xml` – URL-e modeli powinny być poprawne.

---

## Szablon skryptu Python `scripts/merge-r2-folders.py`

```python
#!/usr/bin/env python3
"""
Merge folderów R2: kopiuje obiekty z folderA/ do folderB/.
Użycie: python scripts/merge-r2-folders.py "emilia szymanska" emiliaszymanska [--dry-run]
"""
import os
import sys
import argparse

# Załaduj .env (jak w rename-r2-source-photos.py)
# Użyj boto3 copy_object dla każdego obiektu pod prefixem A/
# Opcja --dry-run: tylko listuj, nie kopiuj
# Kolizje: skip jeśli B już ma plik (lub --overwrite)
```

---

## Checklist przed produkcją

- [ ] Backup DB wykonany
- [ ] Weryfikacja folderów w R2 (`--list-prefixes`)
- [ ] Merge R2 wykonany (copy objects)
- [ ] SQL migracji wykonany (w transakcji)
- [ ] Folder źródłowy usunięty z R2
- [ ] Sync + Import w admin
- [ ] Testy manualne na frontendzie
- [ ] Sitemap zweryfikowany

---

## Ryzyka i uwagi

1. **Kolizje plików:** Jeśli A i B mają plik o tej samej nazwie – ustal strategię (zachowaj B, lub dodaj suffix).
2. **`unique_id`:** Zdjęcia – format `folderName-filename`. Duplikaty trzeba obsłużyć.
3. **Spacja w "emilia szymanska":** Zweryfikuj dokładną nazwę folderu w R2 (może być `emilia.szymanska`).
4. **Kolejność angelijustx → angeljustx → angeljustxfree:** Wykonaj w tej kolejności.

---

## Kontakt

W razie pytań – Product Manager.
