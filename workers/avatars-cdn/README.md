# Files CDN Worker (`files.dyskiof.net`)

Cloudflare Worker na **tym samym** bucketcie R2 co backend (`files`). Serwuje:

- **`avatars/*`** — avatary i headery modeli (**publiczne**, bez podpisu)
- **Pozostałe klucze** — miniatury, HLS (`.m3u8`, `.ts`, …) — **gatekeeper HMAC** zgodny z backendem (`thumbnailpub.SignMediaURLToken`)

## Bezpieczeństwo

- Brak path traversal (`..`, `\`)
- **Zablokowany prefix `proofs/`** — dowody płatności nie są serwowane po HTTP
- Tylko **GET / HEAD / OPTIONS**
- **HMAC:** `?token=` (hex 64) i `expires=` (Unix sekundy). Treść podpisu: `canonicalR2Key + "\n" + expires` (klucz jak po `pathnameToR2Key`, segmenty URL zdekodowane).
- **Sesja HLS (opcjonalna):** po poprawnym żądaniu z tokenem Worker może ustawić cookie `cv_media_sess` (HttpOnly, Secure, SameSite=None) na kolejne żądania bez query. Frontend **nie** wysyła `withCredentials` na CDN — każdy segment i tak ma `?token=&expires=` w playliście, więc odtwarzanie nie zależy od tego cookie.
- **CORS:** `MEDIA_CDN_ALLOWED_ORIGINS` — lista originów (przecinek), np. `https://dyskiof.net,https://www.dyskiof.net`. **W produkcji ustaw zawsze, gdy front woła CDN z `withCredentials` (HLS)** — pusta lista = `Access-Control-Allow-Origin: *`, a przeglądarka **odrzuca** odpowiedź przy credentials (w Network widać 200, a request na czerwono). Z listą: echo `Origin` + `Access-Control-Allow-Credentials: true`.
- **Wyłączenie gatekeepera:** brak `MEDIA_CDN_SIGNING_SECRET` **lub** `MEDIA_GATEKEEPER_DISABLED=1` → zachowanie legacy (cały bucket publicznie czytelny poza `proofs/`). **Nie stosować w produkcji z treścią płatną.**

## Backend

W `.env` API (wartości muszą być zgodne z Workerem):

```env
R2_PUBLIC_URL=https://files.dyskiof.net
# Domyślnie podpis używa STREAMING_TOKEN_SECRET; opcjonalnie osobno:
# MEDIA_CDN_SIGNING_SECRET=...
# MEDIA_CDN_URL_TTL_SEC=1800
# MEDIA_CDN_SIGN_URLS=0   # awaryjnie: URL bez podpisu (ryzyko scrapingu)
```

Frontend: `NEXT_PUBLIC_MEDIA_HOST=files.dyskiof.net` (lub lista po przecinku) — `next/image` CDN + HLS `withCredentials` na ten host.

## Weryfikacja gatekeepera

- **Incognito**, URL do `.ts` **bez** `?token=&expires=` → oczekiwane **403**. Jeśli pobiera plik, gatekeeper jest **wyłączony** w Workerze.
- W **DevTools → Network → Response Headers** po deployu tej wersji Workera: nagłówek **`X-CV-Gatekeeper`**
  - **`off`** — brak sekretu albo `MEDIA_GATEKEEPER_DISABLED=1` → cały bucket (poza `proofs/`) jest publicznie czytelny.
  - **`on`** — HMAC włączony; bez poprawnego query → **403**.
- Brak nagłówka `X-CV-Gatekeeper` → ruch **nie idzie** przez tego Workera (np. inna trasa DNS / publiczny R2 zamiast custom domain Workera).

**Naprawa:** W Cloudflare → Worker `avatars-cdn` → **Secrets**: ustaw **`MEDIA_CDN_SIGNING_SECRET`** (ta sama wartość co `STREAMING_TOKEN_SECRET` w API). Usuń **`MEDIA_GATEKEEPER_DISABLED`** z vars (jeśli jest). **Deploy** Workera.

## Deploy

```powershell
cd ContentManager/workers/avatars-cdn
npm install
npx wrangler secret put MEDIA_CDN_SIGNING_SECRET
npx wrangler login   # raz
npm run deploy
```

## Nazwy plików ze spacjami / nawiasami

Worker **dekoduje każdy segment ścieżki** (`decodeURIComponent`), żeby klucz R2 zgadzał się z bucke­tem.

## Edge cache

Odpowiedzi z `?token=` i `expires=` są cache’owane w `caches.default` (klucz = pełny URL). Żądania **tylko** z cookie (bez query) **nie** trafiają do tego cache (uniknięcie mieszania odpowiedzi między użytkownikami).

## Range (HTTP 206)

Obecnie Worker zwraca pełny obiekt. Dla bardzo dużych plików można dodać obsługę nagłówka `Range`.
