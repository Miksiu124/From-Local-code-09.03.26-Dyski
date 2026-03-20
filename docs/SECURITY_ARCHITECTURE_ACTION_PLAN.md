# Plan akcji: Bezpieczeństwo i architektura API

**Cel:** Wdrożenie trzech warstw zabezpieczeń zgodnie z rekomendacjami, przy zachowaniu pełnej funkcjonalności i braku regresji.

**Zasada nadrzędna:** Wszystko musi działać tak jak obecnie. Żadna zmiana nie może zepsuć ani pogorszyć istniejącej funkcjonalności.

---

## Podsumowanie wykonawcze (dla PM)

| # | Warstwa | Stan | Akcja | Ryzyko regresji |
|---|---------|------|-------|-----------------|
| 1 | **Weryfikacja uprawnień** | Częściowo OK | Audyt wszystkich endpointów, naprawa luk (np. IDOR) | Niskie |
| 2 | **Rate limiting** | Tylko auth/referral | Rozszerzenie na models, content, admin, credits | Średnie (testy limitów) |
| 3 | **Ukrycie API (BFF)** | API widoczne w DevTools | Proxy przez Next.js, Nginx nie serwuje Go | Średnie (HLS, SSE) |

**Szacowany czas:** 5–9 dni roboczych (3 fazy, możliwa równoległość 1+2)

### Status wdrożenia (checklist)

- [x] **Faza 1:** Audyt w `docs/ENDPOINT_AUTH_AUDIT.md`; poprawka IDOR w `StreamPurchaseStatus` (poll DB z `user_id`).
- [x] **Faza 2:** Grupowe limity Redis (`middleware/apiratelimit.go`); wyłączenie: `DISABLE_API_RATE_LIMIT=true`.
- [x] **Faza 3 (wariant A):** `src/app/api/[[...path]]/route.ts` → Go; nginx `/api/` → frontend; wyjątek regex BLIK → api; usunięte `rewrites` z `next.config.ts`.

---

## Stan obecny (audyt)

### 1. Weryfikacja uprawnień
- **Auth middleware:** `Authenticate`, `OptionalAuth`, `RequireAdmin`, `RequireEmailVerified` — działają per-route
- **Resource-level access:** Playlist, GetContentDetails, Segment (token) — sprawdzają dostęp do contentu
- **Luki:** Endpointy z `OptionalAuth` mogą zwracać różne dane w zależności od auth — wymaga audytu, czy nie ma IDOR (np. `/api/admin/content/:id` — sprawdzić, czy tylko admin)

### 2. Rate limiting
- **Obecnie:** Redis + rate limiter używany tylko w:
  - Auth: register (10/15min IP, 6/15min email), login (20/5min IP, 10/5min email), forgot-password, reset-password
  - Referral: track (200/min IP)
- **Brak:** Globalnego rate limitu na pozostałe endpointy (models, content, credits, admin, itd.)

### 3. Ukrycie API (BFF)
- **Obecnie:** Browser → Nginx → Go. Klient widzi w DevTools: `/api/models`, `/api/auth/me`, `/api/content/...` itd.
- **fetchApi** (api-client.ts) — używany tylko po stronie serwera (Server Components)
- **Client-side fetch:** ~25+ wywołań `fetch('/api/...')` w komponentach klienckich — bezpośrednio do Go przez Nginx

---

## Faza 1: Weryfikacja uprawnień (priorytet najwyższy)

### 1.1 Audyt endpointów — checklist

Dla każdego endpointu w `main.go` zweryfikować:

| Endpoint | Wymaga auth? | Wymaga roli? | Wymaga dostępu do zasobu? | Status |
|----------|--------------|--------------|---------------------------|--------|
| `GET /api/models` | Nie (public) | - | - | OK |
| `GET /api/models/:slug` | Nie | - | - | OK |
| `GET /api/models/:slug/content` | Nie | - | - | OK |
| `GET /api/models/:modelId/access` | Optional | - | - | OK |
| `GET /api/content/:id/thumbnail` | Optional | - | Sprawdzić: czy thumbnail wymaga dostępu | Do weryfikacji |
| `GET /api/content/:slug/:id/details` | Optional | - | GetContentDetails ma access check | OK |
| `GET /api/content/:id/playlist/*` | Tak | - | CheckContentAccess | OK |
| `GET /api/content/:id/segment/*` | Token | - | Token = access | OK |
| `GET /api/admin/content/:id` (DELETE) | Tak | Admin | Sprawdzić: czy admin może usuwać dowolny content | Do weryfikacji |
| `GET /api/favorites/*` | Tak | - | User widzi tylko swoje | OK |
| `GET /api/admin/users/:id` | Tak | Admin | Sprawdzić: czy admin ma dostęp do dowolnego usera | OK (admin = full) |
| ... | ... | ... | ... | ... |

**Akcje:**
1. [ ] Przeprowadzić pełny audyt wszystkich ~60 endpointów
2. [ ] Dla endpointów z ID w ścieżce — dodać weryfikację, czy użytkownik ma prawo do tego zasobu (np. `GET /api/admin/users/:id` — tylko admin; `GET /api/credits/purchase/:id` — tylko właściciel)
3. [ ] Udokumentować wyniki w pliku `ENDPOINT_AUTH_AUDIT.md`
4. [ ] Naprawić wykryte luki przed przejściem do Fazy 2

### 1.2 Konkretne poprawki (po audycie)

- **Credits purchase:** `GET /api/credits/purchase/:id/status` — upewnić się, że zwraca tylko purchase danego usera
- **Admin content:** `DELETE /api/admin/content/:id` — już za admin middleware, OK
- **Thumbnail:** Obecnie `OptionalAuth` — jeśli thumbnail ma być publiczny dla preview, OK; jeśli ma być restricted — dodać access check

---

## Faza 2: Rozszerzenie rate limitingu

### 2.1 Strategia

- **Nie usuwać** istniejącego rate limitingu na auth — pozostaje jak jest
- **Dodać** globalny lub grupowy rate limit na pozostałe endpointy

### 2.2 Propozycja limitów

| Grupa | Limit | Okno | Uzasadnienie |
|-------|-------|------|--------------|
| Auth (login, register, forgot, reset) | Istniejące | - | Bez zmian |
| Public (models, countries, settings, geo) | 300 req/min | 1 min | Skanowanie API, brute force |
| Content (thumbnails, playlists, segments) | 200 req/min | 1 min | Ochrona przed scrapingiem |
| User (balance, profile, favorites, purchases) | 120 req/min | 1 min | Normalne użycie |
| Credits (purchase flow) | 30 req/min | 1 min | Ograniczenie abuse |
| Admin | 100 req/min | 1 min | Panel admina |

### 2.3 Implementacja

1. [ ] Dodać middleware `RateLimitByPath` lub `RateLimitByGroup` w Go
2. [ ] Zastosować na grupach route'ów (api.Group z middleware)
3. [ ] Zwracać `429 Too Many Requests` z nagłówkiem `Retry-After`
4. [ ] Testy: upewnić się, że normalne flow nie przekracza limitów
5. [ ] Monitoring: logować 429 w production

### 2.4 Rollback

- Rate limiter można wyłączyć przez feature flag lub ustawienie bardzo wysokiego limitu w configu

---

## Faza 3: Ukrycie API — wzorzec BFF

### 3.1 Cel

- Użytkownik **nigdy** nie widzi w DevTools wywołań do `/api/*` Go
- Przepływ: `Browser → Next.js (Server Actions / Route Handlers) → Go (http://api:8080)`
- Nginx: `/api/*` **nie** serwowane publicznie — tylko wewnętrznie dla Next.js (lub w ogóle nie, jeśli Next.js łączy się bezpośrednio z Go)

### 3.2 Mapowanie wywołań klienckich

Wszystkie `fetch('/api/...')` w komponentach klienckich muszą zostać przeniesione do Server Actions lub Route Handlers.

| Plik | Endpointy | Akcja |
|------|-----------|-------|
| `models-grid.tsx` | `/api/models`, `/api/countries` | Server Action lub Route Handler |
| `model-detail.tsx` | `/api/content/...`, `/api/favorites`, `/api/admin/content`, `/api/models/.../content`, `/api/user/balance`, `/api/purchases` | Server Actions |
| `favorites-grid.tsx` | `/api/favorites` | Server Action |
| `content-viewer.tsx` | `/api/favorites/check`, `/api/favorites`, `/api/content/...` | Server Actions |
| `credit-purchase-flow.tsx` | `/api/credits/purchase/...` | Server Actions |
| `custom-links-client.tsx` | `/api/admin/custom-links/...` | Server Actions |
| `admin/users/page.tsx` | `/api/admin/users/...` | Server Actions |
| `admin/models/page.tsx` | `/api/admin/models` | Server Action |
| `admin/analytics/page.tsx` | `/api/admin/analytics` | Server Action |
| `admin/promo-codes/page.tsx` | `/api/admin/promo-codes/...` | Server Actions |
| `admin-payments-list.tsx` | `/api/admin/credits/purchases/...` | Server Actions |
| `admin/packages/page.tsx` | `/api/admin/packages/...` | Server Action |
| `header.tsx` | `/api/auth/me`, `/api/user/balance`, `/api/auth/logout` | Server Actions |
| `notification-bell.tsx` | `/api/notifications`, `/api/notifications/stream` | Server Actions + SSE proxy |
| `video-player.tsx` | `/api/user/preferences`, `/api/content/.../playlist`, `/api/content/.../segment` | **Specjalne:** HLS i segmenty muszą iść przez proxy lub pozostać (patrz 3.5) |
| `my-purchases/page.tsx` | `/api/purchases`, `/api/credits/purchase` | Server Actions |

### 3.3 Strategia migracji (bez regresji)

**Krok 1: Dual-write (opcjonalnie)**  
- Dodać Route Handlers w Next.js pod `/api/...` które proxy do Go  
- Frontend nadal wywołuje `/api/...` — Nginx kieruje do Next.js zamiast Go  
- Next.js proxy do `http://api:8080/api/...`  
- **Efekt:** Klient nadal widzi `/api/...` — to tylko etap przejściowy

**Krok 2: Pełna migracja**  
- Zmienić frontend na wywołania Server Actions (np. `getModels()`, `getFavorites()`)  
- Server Actions wewnętrznie używają `fetchApi` do Go  
- Nowe ścieżki: np. `POST /actions/get-models` (Server Action) — klient widzi tylko to  
- Nginx: usunąć `location /api/` z publicznego dostępu; dodać `internal` lub `allow` tylko z Next.js

**Krok 3: Konfiguracja Nginx**  
- `location /api/` — `deny all` lub brak proxy do Go z zewnątrz  
- Next.js łączy się z Go przez wewnętrzną sieć Docker (`http://api:8080`)

### 3.4 Specjalne przypadki

**HLS streaming (video-player.tsx):**
- Playlist: `GET /api/content/:id/playlist/master.m3u8` — wymaga auth, cookies
- Segmenty: `GET /api/content/:id/segment/...?token=...&uid=...` — token-based
- **Problem:** HLS.js ładuje URL-e bezpośrednio; nie można łatwo przekazać przez Server Action
- **Rozwiązanie A:** Next.js Route Handler proxy dla `/api/content/*` — `app/api/content/[...path]/route.ts` proxy do Go, przekazuje cookies. Klient nadal widzi `/api/content/...` — ale to jest Next.js, nie Go.  
- **Rozwiązanie B:** Zostawić streaming na bezpośrednim Go (segmenty z tokenem są bezpieczne). Ukryć tylko pozostałe endpointy.  
- **Rekomendacja:** Rozwiązanie A — jeden proxy dla całego `/api/` w Next.js. Wtedy klient widzi `/api/...` ale to Next.js, a Nginx nie serwuje Go publicznie.

**SSE (notifications stream):**
- `EventSource("/api/notifications/stream")` — wymaga proxy przez Next.js
- Next.js Route Handler: `GET /api/notifications/stream` → proxy do Go z cookies

**Obrazy (thumbnails, avatary):**
- `src={/api/content/.../thumbnail}` — img tag ładuje bezpośrednio
- Można zostawić przez proxy Next.js (Route Handler) lub przez osobny subpath np. `/media/...` który Next.js proxy

### 3.5 Proponowana architektura BFF

```
[Browser]
    │
    ├─ Server Components: fetchApi (już server-side) — bez zmian
    │
    ├─ Client Components:
    │   ├─ fetch('/api/...') → ZAMIANA NA →
    │   │   Server Actions (np. getModels, getFavorites) → fetchApi → Go
    │   │   LUB
    │   │   fetch('/bff/...') → Next.js Route Handlers → fetchApi → Go
    │   │
    │   └─ HLS/SSE: fetch('/api/content/...') → Next.js proxy → Go
    │
    └─ Nginx:
        - location / → Next.js (frontend:3000)
        - location /api/ → USUNIĘTE z publicznego (albo proxy do Next.js, który proxy do Go)
```

**Wariant A (prostszy):**  
- Nginx: `location /api/` → proxy do **Next.js** (np. `http://frontend:3000/api/`)  
- Next.js: catch-all `app/api/[...path]/route.ts` → proxy do `http://api:8080/api/` z przekazaniem cookies  
- Frontend: bez zmian w URL-ach (`fetch('/api/...')`)  
- **Efekt:** Klient widzi `/api/...` ale to Next.js; Go jest niewidoczne z zewnątrz  

**Wariant B (pełny BFF):**  
- Frontend: zero `fetch('/api/...')` — tylko Server Actions i ewentualnie `/bff/...`  
- Nginx: brak `location /api/`  
- Next.js: wszystkie wywołania przez fetchApi (server-side)

### 3.6 Plan wdrożenia BFF (zalecany: Wariant A)

1. [ ] Utworzyć `app/api/[...path]/route.ts` — catch-all proxy do Go
2. [ ] Proxy przekazuje: method, headers (w tym cookie), body
3. [ ] Nginx: zmienić `location /api/` z `proxy_pass http://api:8080` na `proxy_pass http://frontend:3000`
4. [ ] Testy E2E: upewnić się, że cała aplikacja działa
5. [ ] (Opcjonalnie) Stopniowo migrować wybrane endpointy na Server Actions (Wariant B) dla lepszej separacji

---

## Harmonogram i kolejność

| Faza | Czas szac. | Zależności | Kryterium ukończenia |
|------|------------|------------|---------------------|
| 1. Weryfikacja uprawnień | 2–3 dni | Brak | Audyt zakończony, luki naprawione |
| 2. Rate limiting | 1–2 dni | Faza 1 (opcjonalnie) | Wszystkie grupy endpointów objęte limitem |
| 3. BFF (Wariant A) | 2–4 dni | Faza 1, 2 | Nginx nie serwuje Go; Next.js proxy działa |

---

## Kryteria akceptacji (Definition of Done)

- [ ] Wszystkie istniejące testy przechodzą
- [ ] Ręczne testy: logowanie, przeglądanie modeli, zakup, odtwarzanie wideo, panel admina
- [ ] Brak nowych błędów w logach
- [ ] Rollback plan udokumentowany dla każdej fazy

---

## Rollback

| Faza | Rollback |
|------|----------|
| 1 | Cofnięcie commitów z poprawkami auth |
| 2 | Wyłączenie rate limit middleware (feature flag lub config) |
| 3 | Nginx: przywrócenie `location /api/` → `proxy_pass http://api:8080` |

---

## Uwagi końcowe

- Każda faza powinna być wdrażana w osobnym PR/merge
- Po każdej fazie — pełna weryfikacja manualna + automaty
- Dokumentacja: aktualizować README i diagramy architektury po wdrożeniu
