# Database Optimization — March 2026

Optimizations applied for faster content serving and more reliable caching.

## Production safety (no data loss)

- **Additive only**: Migration creates indexes only. No `DROP TABLE`, `TRUNCATE`, `DELETE`, or `UPDATE` of user/client data.
- **Client data preserved**: Users, purchases, credit_purchases, user_access, favorites, and all business data are untouched.
- **Rollback safe**: Down migration drops indexes only; no data is removed.

## 1. PostgreSQL Indexes

**Migration:** `backend/migrations/20260316120000_content_serving_optimizations.up.sql`

| Index | Purpose |
|-------|---------|
| `idx_content_items_model_created` | GetBySlug / ListContent `ORDER BY created_at` |
| `idx_content_items_model_duration` | ListContent `ORDER BY duration` (longest/shortest) |
| `idx_models_active_name_id` | Models List cursor pagination `ORDER BY name, id` |

**Apply on existing DB:**
```bash
docker compose exec -T postgres psql -U platform -d content_platform < backend/migrations/20260316120000_content_serving_optimizations.up.sql
```

## 2. Redis Caching

| Endpoint | Cache Key | TTL |
|----------|-----------|-----|
| `GET /api/models` (first page, no filters) | `api:models:first` / `api:models:featured` | 3 min |
| `GET /api/models/:slug` | `api:model:slug:{slug}` | 5 min |
| `GET /api/models/:slug/content` (first page) | `api:model:content:{slug}:{type}:{sort}:first` | 3 min |

**Invalidation:** Automatic on admin SyncR2, ImportR2, ToggleContentHidden, DeleteContent.

## 3. Postgres Tuning (docker-compose)

- `random_page_cost=1.1` — SSD-optimized (default 4.0 for HDD)
- `effective_io_concurrency=200` — SSD parallel I/O

## 4. Redis Tuning

- `lazyfree-lazy-eviction yes` — Non-blocking eviction under memory pressure
- `lazyfree-lazy-server-del yes` — Non-blocking DEL

## 5. Connection Pool (unchanged)

- Postgres: max 20, min 2, 30min lifetime
- Redis: pool 10, min idle 2

---

## 6. CPU / API load reduction (2026-03)

### R2_PUBLIC_URL — krytyczne dla obciążenia API

Gdy `R2_PUBLIC_URL` **nie** jest ustawione, avatary i headery modeli idą przez API (proxy z R2). Każdy request = pobranie z R2 + cache do Redis + stream do klienta → duże obciążenie CPU i sieci.

**Sprawdź na VPS:**
```bash
grep R2_PUBLIC_URL /opt/contentvault/.env
# Powinno być: R2_PUBLIC_URL=https://files.dyskiof.net
```

Gdy ustawione: API zwraca `avatarUrl` i `headerUrl` z bezpośrednim URL CDN → obrazy ładują się z Cloudflare, nie przez API.

### Prefetch RSC wyłączony

Linki do modeli (`/models/:slug`) mają `prefetch={false}` — Next.js nie prefetchuje 20+ stron modeli naraz, co redukuje skoki CPU.

### Gzip Level 3

Kompresja JSON obniżona z 5 do 3 — mniejsze zużycie CPU przy minimalnie większym payloadzie.

### Presigned URLs dla segmentów HLS (2026-03)

Segmenty wideo (.ts) są teraz serwowane bezpośrednio z R2 — klient pobiera je z presigned URL, nie przez API. API przestaje proxyować bajty wideo → **znaczne odciążenie CPU i sieci**.

**Wymaganie:** Bucket R2 musi mieć skonfigurowane CORS, żeby odtwarzacz (dyskiof.net) mógł pobierać segmenty:
- W Cloudflare Dashboard → R2 → bucket → Settings → CORS
- Dodać regułę: `https://dyskiof.net` w Allow-Origin, metoda GET

**Uwaga:** HLS.js nie wysyła `credentials` dla presigned URLs (cross-origin) — tylko dla playlist z API (same-origin). Dzięki temu R2 nie musi zwracać `Access-Control-Allow-Credentials: true`.
