# Upgrade PostgreSQL 16 → 18 — procedura bezpieczna

**Cel:** Przejście na PostgreSQL 18 z zachowaniem 100% danych produkcyjnych.

**Strategia:** pg_dump → usunięcie volume → postgres:18 → pg_restore. Zero ryzyka utraty danych — backup jest tworzony i weryfikowany przed jakąkolwiek destrukcją.

---

## ⚠️ Ważne: kolejność przy deployu

Jeśli masz **istniejącą bazę PG16** i deployujesz nowy kod (compose z PG18):

1. **Najpierw uruchom skrypt upgrade** — zanim `docker compose up` użyje nowego compose
2. W przeciwnym razie PG18 nie uruchomi się na volume z danymi PG16 (błąd: "database files are incompatible")

```bash
# Po deploy (sync) — od razu:
cd /opt/contentvault
bash scripts/upgrade-postgres-16-to-18.sh
```

---

## Szybki start (VPS)

```bash
cd /opt/contentvault
bash scripts/upgrade-postgres-16-to-18.sh
```

**Jeśli upgrade się przerwał** (np. timeout na pg_isready):
```bash
bash scripts/upgrade-postgres-16-to-18.sh --resume
```

Skrypt automatycznie:
1. Tworzy backup (`backups/pre_pg18_upgrade_YYYYMMDD_HHMMSS.dump`)
2. Weryfikuje backup (pg_restore -l)
3. Zatrzymuje postgres, usuwa volume
4. Aktualizuje docker-compose na postgres:18-alpine
5. Uruchamia PG18, przywraca dane
6. Uruchamia resztę serwisów

---

## Warstwa ochrony danych

| Krok | Ochrona |
|------|---------|
| **Backup** | pg_dump -Fc (custom format) — pełna kopia bazy |
| **Lokalizacja** | `backups/` w projekcie (nie /tmp — na VPS może być czyszczony) |
| **Weryfikacja** | pg_restore -l przed usunięciem volume |
| **Compose backup** | sed tworzy docker-compose.yml.bak (PG16) |
| **Volume** | Usuwany dopiero po potwierdzeniu backupu |

---

## Wymagania

- `.env` z `POSTGRES_PASSWORD`
- PostgreSQL 16 musi być uruchomiony (`docker compose up -d postgres`)
- ~2× wolnego miejsca względem rozmiaru bazy (na backup)

---

## Rollback (jeśli coś pójdzie nie tak)

**Uwaga:** `docker-compose.yml.bak` istnieje tylko gdy skrypt wykonał upgrade z 16. Jeśli deploy przyniósł compose z 18, ręcznie zmień `image: postgres:18-alpine` na `postgres:16-alpine`.

```bash
cd /opt/contentvault  # lub ContentManager

# 1. Zatrzymaj wszystko
docker compose down

# 2. Przywróć postgres:16 w compose
mv docker-compose.yml.bak docker-compose.yml  # lub ręczna edycja

# 3. Uruchom postgres (utworzy nowy volume)
docker compose up -d postgres

# 4. Czekaj na gotowość (~30s), potem restore
docker compose run --rm --no-deps \
  -v "$(pwd):/b" -e PGPASSWORD="$POSTGRES_PASSWORD" \
  postgres pg_restore -U platform -d content_platform -h postgres \
  --clean --if-exists --no-owner --no-acl \
  /b/backups/pre_pg18_upgrade_YYYYMMDD_HHMMSS.dump

# 5. Uruchom resztę
docker compose up -d
```

---

## Ręczna procedura (bez skryptu)

Jeśli wolisz wykonać kroki ręcznie:

```bash
# 1. Backup
docker compose exec postgres pg_dump -U platform content_platform -Fc > backups/pre_upgrade.dump

# 2. Weryfikacja
docker run --rm -v $(pwd):/b postgres:16-alpine pg_restore -l /b/backups/pre_upgrade.dump | head -20

# 3. Zatrzymaj postgres
docker compose stop postgres

# 4. Pobierz nazwę volume
VOL=$(docker inspect content-postgres --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}')
echo "Volume: $VOL"

# 5. Usuń volume
docker volume rm $VOL

# 6. Edytuj docker-compose.yml: postgres:16-alpine → postgres:18-alpine

# 7. Uruchom
docker compose up -d postgres

# 8. Czekaj na pg_isready, potem restore
docker compose run --rm --no-deps -v $(pwd):/b -e PGPASSWORD=$POSTGRES_PASSWORD postgres \
  pg_restore -U platform -d content_platform -h postgres --clean --if-exists --no-owner --no-acl /b/backups/pre_upgrade.dump

# 9. Uruchom resztę
docker compose up -d
```

---

## Po upgrade

- **Data checksums:** PG18 ma je domyślnie włączone — lepsza integralność danych
- **AIO (async I/O):** Domyślnie włączone — szybsze odczyty
- **Backup:** Zachowaj `backups/pre_pg18_upgrade_*.dump` przez co najmniej tydzień
- **Weryfikacja:** Sprawdź logi API, frontend, admin panel

