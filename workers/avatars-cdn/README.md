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

Z katalogu repozytorium (np. `c:\Strona\workers\avatars-cdn`):

```powershell
cd workers\avatars-cdn
npm install
npx wrangler login
```

**Sekrety** (wartości jak w backendzie — patrz wyżej):

```powershell
npx wrangler secret put MEDIA_CDN_SIGNING_SECRET
```

Opcjonalnie pod **resize** (`?w=`):

```powershell
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

**Zmienne** (Cloudflare → Workers → `avatars-cdn` → Settings → Variables, albo odkomentuj `[vars]` w `wrangler.toml`):

- `MEDIA_CDN_ALLOWED_ORIGINS` — np. `https://dyskiof.net,https://www.dyskiof.net` (wymagane przy HLS + credentials).
- `R2_ACCOUNT_ID` — ID konta z panelu Cloudflare (Overview po prawej).
- `R2_BUCKET_NAME` — zwykle `files`, jeśli inna nazwa bucketa R2.

Deploy:

```powershell
npm run deploy
```

Albo: `.\deploy.ps1` (wywołuje `wrangler deploy`).

**Domena `files.dyskiof.net`:** musi być podpięta pod tego Workera (w `wrangler.toml` jest `custom_domain = true` — przy pierwszym deployu Wrangler prowadzi przez powiązanie). Strefa DNS `dyskiof.net` powinna być na tym samym koncie Cloudflare co bucket R2 `files`.

## Nazwy plików ze spacjami / nawiasami

Worker **dekoduje każdy segment ścieżki** (`decodeURIComponent`), żeby klucz R2 zgadzał się z bucke­tem.

## Edge cache

Odpowiedzi z `?token=` i `expires=` są cache’owane w `caches.default` (klucz = pełny URL). Żądania **tylko** z cookie (bez query) **nie** trafiają do tego cache (uniknięcie mieszania odpowiedzi między użytkownikami).

## Opcjonalny resize obrazów (`?w=` / `?h=`)

Worker może serwować obrazy przez **Cloudflare Image Resizing** (`cf.image` na subrequescie do R2 po S3 API), żeby przeglądarka nie pobierała pełnej rozdzielczości.

**Wymagania:**

- Na koncie Cloudflare włączone **Image Resizing** (płatne / zależnie od planu — zob. dokumentacja Cloudflare Images).
- W Workerze ustawione te same dane co do R2 po API S3 (buckiet `files` = binding `FILES`):
  - **Vars** (Dashboard / `wrangler.toml`): `R2_ACCOUNT_ID`, opcjonalnie `R2_BUCKET_NAME` (domyślnie `files`).
  - **Secrets:** `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (jak w backendzie `.env`).

```powershell
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

- Awaryjne wyłączenie: `IMAGE_RESIZE_DISABLED=1` (vars).

**Parametry query** (tylko pliki graficzne: jpg, png, webp, gif, avif):

| Param | Znaczenie |
|-------|-----------|
| `w` | max szerokość (px, 1–4096) |
| `h` | max wysokość (px, 1–4096) — wymagane jest `w` i/lub `h` |
| `fit` | `scale-down` (domyślnie), `contain`, `cover`, `crop`, `pad` |
| `q` | jakość 1–100 (domyślnie 85) |
| `format` | `auto`, `webp`, `avif`, `jpeg`, `json` |
| `anim` | `false` / `0` — dla GIF: tylko pierwsza klatka (mniejszy transfer) |

Bez sekretów R2 lub gdy transform się nie powiedzie, Worker zwraca **oryginał** z R2 (jak dotychczas).

### „Nie działa” / ten sam rozmiar / `applied` ale brak efektu

1. **`npm run deploy`** z `workers/avatars-cdn` po zmianach w kodzie.
2. Token R2 używany w Workerze: uprawnienia **odczytu obiektów** na bucketcie `files`, **bez** restrykcji IP (Worker wychodzi z dynamicznych adresów Cloudflare — zawężony IP często daje 403 na S3, wtedy w logach: `cf.image upstream R2 fetch not ok`).
3. W **Workers → Logs** szukaj `[files-cdn] cf.image` oraz `unexpected Content-Type` (np. XML z S3 zamiast obrazu).
4. **Cache przeglądarki / edge:** test w oknie incognito albo dodaj parametr, np. `?w=120&cachebust=1`.
5. Dla `format=auto` Worker ustawia wyjście na **webp** (świadoma transkodacja); jawnie: `?format=avif` lub `?format=jpeg`.

6. Nagłówek **`x-cv-resize-reason: upstream-400`** (lub 403): podpis S3 w nagłówku `Authorization` często **nie przechodzi** razem z subrequestem `cf.image`. Worker używa **presigned URL** (`signQuery: true`). Po zmianie zrób **`npm run deploy`**.

Frontend (`NextImageWithFallback`) dokłada `?w=` przez `loader` next/image zgodnie z szerokością slotu.

## Range (HTTP 206)

Obecnie Worker zwraca pełny obiekt. Dla bardzo dużych plików można dodać obsługę nagłówka `Range`.
