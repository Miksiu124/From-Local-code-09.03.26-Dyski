# Files CDN Worker (`files.dyskiof.net`)

Cloudflare Worker na **tym samym** bucketcie R2 co backend (`files`). Serwuje:

- **`avatars/*`** — avatary i headery modeli  
- **Pozostałe klucze** — zdjęcia i pliki wideo/HLS pod ścieżkami takimi jak w R2 (np. `modelFolder/plik.jpg`, `…/master.m3u8`, segmenty `.ts`)

## Bezpieczeństwo

- Brak path traversal (`..`, `\`)
- **Zablokowany prefix `proofs/`** — dowody płatności mogą trafiać do głównego bucketa; nie mogą być publicznie czytane po HTTP
- Tylko **GET / HEAD / OPTIONS**
- **CORS** `Access-Control-Allow-Origin: *` — potrzebne przy HLS / `fetch` z `dyskiof.net` na `files.dyskiof.net`

> Pełny publiczny odczyt treści modeli zakłada, że w buckecie nie ma innych wrażliwych prefixów. Jeśli coś dodasz (np. `secrets/`), dopisz je do `BLOCKED_PREFIXES` w `src/index.ts`.

## Deploy

```powershell
cd ContentManager/workers/avatars-cdn
npm install
npx wrangler login   # raz
npm run deploy
# lub: .\deploy.ps1
```

Strefa `dyskiof.net` i bucket R2 muszą być w tym samym koncie Cloudflare co Worker.

## Integracja

W `.env` API:

```env
R2_PUBLIC_URL=https://files.dyskiof.net
```

Backend buduje URL-e 1:1 z kluczem obiektu w R2.

## Nazwy plików ze spacjami / nawiasami

W URL pojawia się np. `%20%282%29` dla ` (2).jpg`. Worker **dekoduje każdy segment ścieżki** (`decodeURIComponent`), żeby klucz R2 zgadzał się z tym w buckecie (np. jak w Windows „kopia (2)”).

## Typy MIME

Używane są metadane z R2; jeśli brak — heurystyka po rozszerzeniu (`.m3u8`, `.ts`, `.jpg`, …).

## Range (HTTP 206)

Obecnie Worker zwraca pełny obiekt. Dla bardzo dużych plików wideo poza HLS może być potrzebna obsługa nagłówka `Range` — wtedy rozszerz worker o `R2GetOptions.range`.
