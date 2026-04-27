# saasmail — panel zespołowy (Cloudflare Workers)

W repozytorium Dyskiof **[`saasmail/`](../saasmail)** to **git submodule** wskazujący na [choyiny/saasmail](https://github.com/choyiny/saasmail) — osobna aplikacja: inbox, szablony, sekwencje, API z kluczami. **Nie** zastępuje wysyłki transakcyjnej z backendu Go (weryfikacja e-mail, reset hasła) — tam nadal działa integracja z `docs/EMAIL_VPS_SETUP.md` (`CLOUDFLARE_EMAIL_*`).

## Pierwsze pobranie kodu

Jeśli sklonowałeś samo `ContentManager` bez submodułów:

```bash
cd ContentManager
git submodule update --init --recursive
```

## Wymagania lokalne

- Node.js 18+, **Yarn**, `npm i -g wrangler`
- Konto Cloudflare z **Email Routing** i (dla wysyłki z saasmail) **Email → Sending** dla domeny

## Konfiguracja i deploy (skrót)

Pełny opis: [README saasmail w submodule](../saasmail/README.md) oraz `../saasmail/.dev.vars.example`, `../saasmail/wrangler.jsonc.example`.

1. `cd saasmail && yarn install`
2. `wrangler login`
3. Utwórz zasoby: `wrangler d1 create …`, `wrangler r2 bucket create …`, `wrangler queues create …` (jak w README upstream).
4. `cp wrangler.jsonc.example wrangler.jsonc` — uzupełnij `account_id`, `database_id`, `BASE_URL`, `TRUSTED_ORIGINS`; dla **Cloudflare Email Sending** odkomentuj blok `send_email` / binding `EMAIL`. **Nie** ustawiaj sekretu `RESEND_API_KEY` w produkcji, jeśli chcesz tylko Cloudflare.
5. `cp .dev.vars.example .dev.vars` — `BETTER_AUTH_SECRET`; lokalnie wg przykładu.
6. `yarn db:migrate:dev` lub `yarn db:migrate:prod`
7. `yarn deploy`
8. W Cloudflare **Email → Email Routing** skieruj adresy (np. `support@domena`) na **workera saasmail** (nazwa z `wrangler.jsonc` → `name`).

Subdomena pod UI (np. `mail.dyskiof.net`): w `wrangler.jsonc` sekcja `routes` / `custom_domain` — przykład w `wrangler.jsonc.example` upstream.

## Współdziałanie z Dyskiof

| System | Rola |
|--------|------|
| **Dyskiof (Go)** | Maile transakcyjne → REST `CLOUDFLARE_EMAIL_*` **albo** (gdy ustawione) `SAASMAIL_SEND_URL` + `SAASMAIL_API_KEY` → `POST /api/send` w Saasmail, żeby wysyłka była widoczna w panelu. |
| **saasmail** | Odbiór routowany do Workera + panel zespołu; własna wysyłka z Workera (`EMAIL` lub Resend). |

Jedna domena w **Email → Sending** może obsługiwać nadawców używanych przez oba systemy — ważne, żeby adresy w `SMTP_FROM` (Dyskiof) i „from” w saasmail były z **zweryfikowanej** domeny.

## Aktualizacje upstream

```bash
cd saasmail
git fetch origin && git checkout main && git pull
# wróć do ContentManager i zacommituj nowy SHA submodułu, jeśli chcesz przypiąć wersję
```

Albo wg README upstream: skill `/update-saasmail` w Claude Code.

---

## Wdrożenie na koncie Hardliferoot (2026-04-27)

- **Worker:** `saasmail-dyskiof`  
- **URL panelu:** https://saasmail-dyskiof.hardliferoot.workers.dev  
- **D1:** `saasmail-dyskiof-db`  
- **R2:** `saasmail-dyskiof-attachments`  
- **Kolejka:** `saasmail-dyskiof-sequence-emails`  
- **Wysyłka:** binding `EMAIL` (Cloudflare Email Sending) — bez `RESEND_API_KEY`.  
- **Konfiguracja lokalna:** `saasmail/wrangler.jsonc` (jest w `.gitignore` submodułu — nie trafia do gita upstreamu; zrób kopię zapasową).

Migracje D1: plik `0020_emails_fts.sql` w tym forku jest rozdzielony (`0020` + `0021`), a triggery FTS (`emails_fts_ad`, `emails_fts_au`, `emails_fts_ai`) zostały dołożone jednym poleceniem `wrangler d1 execute`, bo D1 w batchu migracji źle traktuje średniki w `BEGIN … END`.

**Email Routing (odbiór):** w Cloudflare **Email → Email Routing** dodaj regułę „Send to Worker” → worker **`saasmail-dyskiof`**. Przy pierwszym użyciu uruchom `npx wrangler login` i dołącz zakresy **email_routing** / **email_sending**, jeśli panel o to poprosi.

**Pierwsze konto:** wejdź na URL panelu i załóż konto administratora (jak w README saasmail).
