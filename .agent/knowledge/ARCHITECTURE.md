# Architektura — ContentVault

## Diagram komunikacji

```
[User Browser]
    │
    ├─ SSR requests ──→ [Next.js :3000] ──fetchApi()──→ [Go API :8080] ──→ [PostgreSQL]
    │                         │                              │                  
    ├─ /api/* rewrites ───────┘                              ├──→ [Redis]
    │                                                        │
    └─ HLS segments ──────────────────────────────────────→ [R2 via Go proxy]
```

## Frontend → Backend komunikacja

### Server-Side (SSR)
- `src/lib/api-client.ts` → `fetchApi<T>(path)` — server component, forwanuje cookies
- Base URL: `http://api:8080/api` (Docker) lub `http://localhost:8080/api` (dev)
- Automatyczna detekcja Docker vs localhost

### Client-Side
- `next.config.ts` rewrites: `/api/:path*` → `http://api:8080/api/:path*`
- Klient robi fetch na `/api/...` — Next.js proxy'uje do Go

## Middleware stack

### Next.js Middleware (`src/middleware.ts`)
- Matcher: `/api/:path*`
- CSRF: sprawdza Origin/Referer vs expected origin
- Rate limiting: 120 req/min na IP+path (300 dla OPTIONS)
- Upstash Redis (@upstash/ratelimit, @upstash/redis)

### Go Middleware (`backend/internal/middleware/`)
- CORS (custom, konfigurowany z `cfg.FrontendURL`)
- Auth (`Authenticate` — wymaga valid session, `OptionalAuth` — opcjonalnie)
- Admin (`RequireAdmin` — sprawdza czy user jest admin)
- Rate Limiter (Redis-based)

## Auth flow

1. NextAuth (frontend) — rejestracja/login z email+password (bcrypt)
2. **Session cookie** → forwandowana przez `fetchApi()` do Go
3. Go API sprawdza `session_token` w DB (tabela `sessions`)
4. JWT używany do streaming tokens (HLS) — osobny secret

## Content / HLS flow

1. Modele → zsynchronizowane z R2 (automatycznie co 1h, lub ręcznie admin)
2. ContentItem ma: `thumbnailPath`, `sourceVideoPath`, `hlsMasterPath`, `hlsFolderPath`
3. Streaming: `/api/content/:id/playlist/:filename` → Go czyta z R2, podpisuje segmenty JWT tokenem
4. Segmenty: `/api/content/:id/segment/:filename` → walidacja tokena, proxy z R2
5. Frontend: `hls.js` player z quality selector

## System kredytów

```
[User] ─kupuje→ [CreditPackage] ─tworzy→ [CreditPurchase (PENDING)]
                                              │
                            Admin approve ─────┤
                                              ↓
                                    [CreditTransaction (PURCHASE)]
                                    [User.creditBalance += credits]
                                              │
                            User kupuje ──────┤
                            dostęp            ↓
                                    [Purchase] + [UserAccess] + [CreditTransaction (SPEND)]
```

### Metody płatności
- **BLIK** — kod 6-cyfrowy, WebSocket real-time, expiration timer
- **Crypto** — BTC/ETH/USDT/USDC, user podaje txId
- **PayPal** — instrukcje manualne
- **Revolut** — instrukcje manualne

### Dostęp do treści
- **Indywidualny model**: 7 lub 14 lub 30 dni
- **Bundle (wszystkie modele)**: 14 lub 30 dni
- `UserAccess.expiresAt` — null = lifetime (nie używane już)

## R2 Sync (Cloudflare R2)

- `backend/internal/content/service.go` → `RunFullSync()`
- Automatyczny cron: co godzinę
- Startup: natychmiastowy sync
- Admin: `/api/admin/r2/sync` — ręczny trigger
- Mapuje foldery R2 → Model → ContentItem (unikalny `uniqueId`)
- Wspierany upload avatarów: `/api/admin/r2/avatars`

## Caching / Performance

- Redis: rate limiting, session cache, real-time streams (SSE/WebSocket)
- Next.js: `cache: "no-store"` domyślnie (SSR fresh data)
- Nginx: proxy cache headers, kompresja
- Images: avif/webp, 24h minimum cache TTL
