# Audyt bezpieczeństwa — ContentVault

**Data:** 2026-02-26  
**Ostatnia aktualizacja:** 2026-02-27 (audyt po nowych funkcjach)  
**Zakres:** Backend (Go), Frontend (Next.js), Nginx, Docker, konfiguracja

---

## Audyt 2026-02-27 — nowe funkcje

### Znalezione i naprawione luki

| # | Problem | Ryzyko | Status |
|---|---------|--------|--------|
| 1 | **UploadProof – brak walidacji purchaseID** | Path traversal w R2 przy złym ID (np. `../`) | ✅ NAPRAWIONE: `IsValidUUID(purchaseID)` |
| 2 | **Thumbnail – brak sanitizacji filename** | Path traversal przez param `:filename` w URL | ✅ NAPRAWIONE: `sanitizeFilename(rawFilename)` |
| 3 | **video-player.tsx – brak cleanup error listener** | Memory leak w gałęzi native HLS (Safari) | ✅ NAPRAWIONE: `removeEventListener` w cleanup |

### Sprawdzone obszary – OK

- **EventSource/SSE** – admin-payments-list, notification-bell, credit-purchase-flow: wszystkie mają `return () => es.close()` w useEffect
- **setInterval/setTimeout** – modele-grid, header, payment-countdown: cleanup z `clearInterval`/`clearTimeout`
- **addEventListener** – content-viewer, model-detail, header, notification-bell: wszystkie mają `removeEventListener` w return
- **Rate limit** – in-memory fallback z eviction (50k max), access cache z eviction (10k max)
- **dangerouslySetInnerHTML** – tylko JSON.stringify danych statycznych (schema.org)
- **path-guard** – walidacja R2 paths (Next.js), sanitizeFilename w backendzie (Playlist, Segment)
- **SQL** – parametryzowane zapytania (Prisma, pgx)

---

## 1. Pozytywne praktyki (już wdrożone)

| Obszar | Status | Szczegóły |
|--------|--------|-----------|
| **Hasła** | ✅ | bcrypt (cost 12), min 8 znaków, wymagania (wielka/mała/cyfra) |
| **Sesje JWT** | ✅ | HttpOnly cookie, SameSite=Lax, Secure w produkcji |
| **Sesje Redis** | ✅ | Weryfikacja tokena w Redis przy każdym request |
| **Ban użytkownika** | ✅ | Sprawdzanie `is_banned` w middleware auth |
| **CSRF** | ✅ | Sprawdzanie Origin/Referer dla POST (oprócz /api/auth/*) |
| **Rate limiting** | ✅ | Next.js middleware (120/min), Go (register, login, forgot-password) |
| **SQL** | ✅ | Parametryzowane zapytania (pgx), brak string concat do SQL |
| **HLS token** | ✅ | HMAC-SHA256, expiracja, walidacja ścieżki segmentu |
| **Upload plików** | ✅ | `http.DetectContentType`, whitelist `image/*`, limit rozmiaru |
| **Nginx** | ✅ | security headers, `server_tokens off`, `ssl_reject_handshake on` dla IP |
| **Secrets** | ✅ | .env w .gitignore, brak hardcodowanych kluczy |
| **Error handling** | ✅ | 500 nie ujawnia wewnętrznych błędów |
| **Admin routes** | ✅ | `RequireAdmin` middleware (role + IsAdmin email) |

---

## 2. Ustalenia wymagające uwagi

### 2.1 Średni priorytet

| # | Problem | Ryzyko | Zalecenie |
|---|---------|--------|-----------|
| 1 | **Auth routes bez Origin check** | Trudniejszy atak CSRF na login/register (niskie P, bo POST z JSON) | Rozważyć CSRF token dla /api/auth/register, /api/auth/login |
| 2 | **JWT fallback na Bearer** | Token w headeru może wyciec przez Referer / logi serwera proxy | ✅ **OPCJA:** `DISABLE_BEARER_AUTH=true` — tylko cookie |
| 3 | **UpdateSettings – dowolne klucze** | Admin może nadpisać np. `discord_webhook_url` | ✅ **NAPRAWIONE:** Whitelist: blik_enabled, max_pending_*, crypto_wallets, paypal_address, revolut_address, discord_* |
| 4 | **`dangerouslySetInnerHTML`** | Potencjalne XSS, jeśli dane dynamiczne | Obecnie tylko `JSON.stringify` – OK. Upewnij się, że nigdzie nie wstrzykujesz user input |
| 5 | **`requireEnv` zwraca ""** | ~~Aplikacja może startować bez JWT_SECRET / R2~~ | ✅ **NAPRAWIONE:** `Config.Validate()` przy starcie, min 32 znaki na sekrety |
| 6 | **Redis bez hasła** | Nieautoryzowany dostęp do Redis z sieci wewnętrznej | ✅ **NAPRAWIONE:** `REDIS_PASSWORD` w .env → auto konfiguracja redis + REDIS_URL |

### 2.2 Niski priorytet

| # | Problem | Zalecenie |
|---|---------|-----------|
| 7 | **CSP `unsafe-inline`** | Zmniejsza ochronę przed XSS | Stopniowe usuwanie inline styles/scripts |
| 8 | **Session TTL 30 dni** | Długie sesje po kradzieży cookie | Skrócić np. do 7 dni, lub dodać „Remember me” |
| 9 | **Postgres `sslmode=disable`** | Dane DB w tranzycie bez TLS | Dokumentacja: `.env.production.example` — dla zewn. DB użyj `?sslmode=require` |

---

## 3. Brak wykrytych krytycznych luk

- Brak SQL injection (parametryzowane zapytania)
- Brak path traversal w uploadach (modelID z DB → folder_name)
- Brak otwartych redirectów
- Brak ujawniania stack trace w odpowiedziach

---

## 4. Rekomendacje wdrożeniowe

### Krótkoterminowe (1–2 dni) — WYKONANE ✅

1. **Walidacja sekretów przy starcie** – `config.Validate()` sprawdza JWT_SECRET, STREAMING_TOKEN_SECRET, R2*, min 32 znaki.
2. **Whitelist UpdateSettings** – `allowedSettingsKeys` w `admin/handler.go`.

### Średnioterminowe (1–2 tygodnie) — CZĘŚCIOWO ✅

3. **Redis auth** – ✅ `REDIS_PASSWORD` w .env → docker-compose auto-config.
4. **Postgres SSL** – ✅ `.env.production.example` z komentarzem; dla zewn. DB: `?sslmode=require` w `DATABASE_URL`.
5. **CSRF token** – rozważyć dla formularzy rejestracji/logowania (np. Double Submit Cookie).
6. **SESSION_TTL_DAYS=7** – opcjonalnie: krótsze sesje (domyślnie 30 dni).
7. **DISABLE_BEARER_AUTH=true** – opcjonalnie: tylko cookie, bez Authorization: Bearer.

### Długoterminowe

8. **Audyt zależności** – `go mod` i `npm audit` co kilka miesięcy.
9. **Monitoring błędów** – Sentry / podobne do logowania 500 i podejrzanych requestów.

---

## 5. Przegląd plików krytycznych

| Plik | Uwagi |
|------|--------|
| `backend/internal/auth/handler.go` | Cookie: HttpOnly, SameSite, Secure |
| `backend/internal/middleware/auth.go` | JWT + Redis session + ban check |
| `backend/internal/middleware/admin.go` | Role + IsAdmin |
| `backend/internal/config/config.go` | `requireEnv` – brak walidacji „non-empty” |
| `src/middleware.ts` | CSRF (Origin) + rate limit |
| `nginx/nginx.conf.production` | CSP, HSTS, X-Frame-Options, ssl_reject |

---

## 6. Checklist przed produkcją

- [ ] Wszystkie sekrety wygenerowane (`openssl rand -hex 32`)
- [ ] `ADMIN_EMAILS` ustawione na prawdziwe adresy
- [ ] `FRONTEND_URL` = https://domena
- [ ] `NEXT_PUBLIC_APP_URL` = https://domena
- [ ] Redis z hasłem (produkcja)
- [ ] Postgres `sslmode=require` (produkcja)
- [ ] Sprawdzenie `npm audit` i `go mod tidy`
- [ ] Weryfikacja SSL (np. SSLLabs A+)
