# Audyt folderu angeljustxfree

Sprawdzenie martwego kontentu (bez miniatur, bez możliwości odczytu) w folderze **angeljustxfree** na stronie, w bazie danych i na R2.

## Szybki start

### 1. Baza danych (PostgreSQL)

```bash
cd ContentManager
docker compose exec -T postgres psql -U platform -d content_platform < scripts/audit-angeljustxfree.sql
```

**Co sprawdza:**
- Statystyki: VIDEO vs PHOTO, widoczne vs ukryte
- **Martwy kontent bez miniatury:** PHOTO bez `thumbnail_path`, VIDEO bez `thumbnail_path` i bez `hls_folder_path` (brak fallbacku)
- **VIDEO bez HLS:** nie da się odtworzyć (brak `hls_master_path` i `hls_folder_path`)
- Podsumowanie procentowe martwego kontentu

### 2. R2 (Cloudflare)

```bash
cd ContentManager
# Upewnij się, że .env zawiera: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT
python scripts/audit-angeljustxfree-r2.py
```

**Co sprawdza:**
- Liczbę obiektów i rozmiar w folderze `angeljustxfree/`
- Kategorie: thumbnails, HLS playlists, HLS segments, source video, photos
- Liczbę folderów HLS (z master.m3u8)

### 3. Sprawdzenie istnienia ścieżek z DB w R2

Eksportuj ścieżki z bazy i zweryfikuj w R2:

```bash
# Eksport thumbnail_path i sprawdzenie w R2 (ścieżki ze stdin)
docker compose exec -T postgres psql -U platform -d content_platform -t -A -c "
  SELECT thumbnail_path FROM content_items ci
  JOIN models m ON m.id = ci.model_id
  WHERE m.folder_name = 'angeljustxfree' AND thumbnail_path IS NOT NULL AND TRIM(thumbnail_path) != ''
  LIMIT 50
" | python scripts/audit-angeljustxfree-r2.py --check-from-stdin

# Alternatywnie: ścieżki oddzielone przecinkiem
python scripts/audit-angeljustxfree-r2.py --check-exists "angeljustxfree/xxx.jpg,angeljustxfree/yyy.jpg"
```

## Interpretacja wyników

| Problem | Znaczenie |
|--------|----------|
| **PHOTO bez thumbnail_path** | Zdjęcie nie wyświetli się na stronie – brak pliku w R2 lub brak wpisu |
| **VIDEO bez hls_master_path i hls_folder_path** | Film nie da się odtworzyć – brak HLS w R2 |
| **VIDEO bez thumbnail_path i bez hls_folder_path** | Brak miniatury – użytkownik zobaczy placeholder lub błąd |
| **Ścieżka w DB, brak w R2** | Plik został usunięty lub nigdy nie zsynchronizowany |

## Rekomendacje

1. **Ukryj martwy kontent:** Ustaw `is_hidden = true` dla pozycji bez miniatury/HLS, aby nie psuły UX.
2. **Usuń z DB:** Jeśli pliki nie istnieją w R2 i nie planujesz ich przywracać – usuń wpisy z `content_items`.
3. **Re-import:** W panelu admin (`/admin/models`) uruchom "Import from R2" dla angeljustxfree – może wykryć brakujące wpisy lub zaktualizować ścieżki.
4. **Sync R2:** Uruchom "Sync R2" – weryfikuje spójność folderów z bazą.

## Kontekst merge

Folder `angeljustxfree` był celem merge z `angeljustx` (zgodnie z `R2_FOLDER_MERGE_INSTRUCTIONS.md`). Martwy kontent mógł powstać przy:
- Niepełnym skopiowaniu z angeljustx do angeljustxfree
- Usunięciu plików źródłowych przed migracją
- Błędach w migracji DB (np. ścieżki nie zaktualizowane)
