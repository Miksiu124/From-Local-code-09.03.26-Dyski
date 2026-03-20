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

**Wymagania:** Strefa `dyskiof.net` musi być w tym samym koncie Cloudflare co bucket R2 `files`.

```powershell
# Zaloguj się (jeśli jeszcze nie)
npx wrangler login

# Deploy (custom domain files.dyskiof.net jest w wrangler.toml)
.\deploy.ps1
# lub: npm run deploy
```

Po deploy Worker będzie dostępny pod `https://files.dyskiof.net` — tylko ścieżki `avatars/*` są dozwolone.

## Integracja z backendem

W `.env` na VPS ustaw:

```
R2_PUBLIC_URL=https://files.dyskiof.net
```

Backend będzie przekierowywał żądania avatarów/headerów na ten URL zamiast proxy przez Go.

## Format URL

- Avatar: `https://files.dyskiof.net/avatars/{slug}_avatar.webp`
- Header: `https://files.dyskiof.net/avatars/{slug}_header.webp`

Worker mapuje ścieżkę 1:1 na klucz R2: `avatars/{plik}`.

## Bezpieczeństwo

- Tylko ścieżki `avatars/*` są dozwolone
- Path traversal (`..`) jest blokowany
- Metody inne niż GET/HEAD zwracają 405
