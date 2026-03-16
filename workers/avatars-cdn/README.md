# Avatars CDN Worker

Cloudflare Worker, który serwuje **tylko** folder `avatars/` z bucketa R2. Wszystkie inne ścieżki zwracają 403 Forbidden.

## Dlaczego Worker?

R2 Public Development URL i Custom Domain udostępniają **cały** bucket. Ten Worker ogranicza dostęp wyłącznie do `avatars/*`, co jest bezpieczniejsze.

## Wymagania

- Cloudflare konto z Workers
- Bucket R2 `files` (lub inny — zmień `bucket_name` w `wrangler.toml`)
- Domena w Cloudflare (opcjonalnie — można użyć `*.workers.dev`)

## Instalacja

```bash
cd ContentManager/workers/avatars-cdn
npm install
```

## Konfiguracja

1. **Wrangler login** (jeśli jeszcze nie):
   ```bash
   npx wrangler login
   ```

2. **W `wrangler.toml`** upewnij się, że:
   - `bucket_name = "files"` — nazwa Twojego bucketa R2
   - Bucket musi być w tym samym koncie Cloudflare co Worker

## Deploy

```bash
npm run deploy
```

Po deploy Worker będzie dostępny pod adresem `https://avatars-cdn.<twoj-subkonto>.workers.dev` (jeśli masz workers.dev).

## Custom Domain (produkcja)

1. W Cloudflare Dashboard → Workers & Pages → avatars-cdn → Settings → Domains
2. Kliknij **Add Custom Domain**
3. Wpisz np. `avatars.twojadomena.com`
4. Cloudflare doda rekord DNS automatycznie

## Integracja z backendem

W `.env` backendu ustaw:

```
R2_PUBLIC_URL=https://avatars.twojadomena.com
```

Backend będzie przekierowywał żądania avatarów/headerów na ten URL zamiast proxy przez Go.

## Format URL

- Avatar: `https://avatars.twojadomena.com/avatars/{slug}_avatar.webp`
- Header: `https://avatars.twojadomena.com/avatars/{slug}_header.webp`

Worker mapuje ścieżkę 1:1 na klucz R2: `avatars/{plik}`.

## Bezpieczeństwo

- Tylko ścieżki `avatars/*` są dozwolone
- Path traversal (`..`) jest blokowany
- Metody inne niż GET/HEAD zwracają 405
