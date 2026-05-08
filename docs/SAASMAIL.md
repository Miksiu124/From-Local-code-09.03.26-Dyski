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
| **Dyskiof (Go)** | Maile transakcyjne i marketingowe → REST **`CLOUDFLARE_EMAIL_*`** (alternatywnie SMTP). **Nie** przechodzi już przez Worker Saasmail. |
| **saasmail** | Odbiór routowany do Workera + panel zespołu; własna wysyłka z Workera (`EMAIL` lub Resend). |

### Inbox w panelu vs wysyłka z API (ważne)

Lista konwersacji (**Inbox** → kolumna osób) w UI Saasmail pochodzi z zapytania po tabeli **`emails`** — czyli **wyłącznie wiadomości przychodzące** (Email Routing → worker). **`POST /api/send`** zapisuje rekord w **`sent_emails`**; w wątku danej osoby pojawi się jako „sent” **tylko wtedy**, gdy istnieje wiersz **`people`** z tym samym adresem co `to` **i** otworzysz tę osobę z listy (a na listę trafiają zwykle tylko kontakty z co najmniej jednym **odbieranym** mailem). Dla zimnego adresu (np. pierwszy reset hasła do skrzynki, której nie było w Saasmail) **`person_id` w `sent_emails` może być `null`** — wtedy **w ogóle nie zbudujesz wątku w Inbox**, mimo że mail wyszedł i dotarł do odbiorcy.

**Podsumowanie:** panel Saasmail **nie** jest skrzynką „wszystkich wysłanych transakcyjnie”; to CRM na **przychodzące** + wysłane w kontekście znanej osoby. Potwierdzanie resetów: skrzynka odbiorcy, logi backendu (`[Mailer]` / Loki `log_category="mailer"`), ewentualnie logi / metryki Workera w Cloudflare.

### Opóźnienie od kliknięcia resetu do maila w skrzynce

Typowy łańcuch: **Dyskiof → HTTP do Workera → Cloudflare Email Sending (kolejka) → SMTP odbiorcy (np. Proton)**. Opóźnienie **30 s–kilka minut** po stronie dostawcy poczty nie jest rzadkie; pierwsze żądanie po zimnym starcie workera może dodać sekundy. Przy błędach 429/5xx backend **retry** (kilka prób z backoffem) celowo wydłuża czas przed rezygnacją lub fallbackiem.

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

**Wysyłka z panelu (Reply / Compose):** worker musi mieć skonfigurowany **binding `EMAIL`** (Cloudflare Email Sending) **albo** `RESEND_API_KEY`. Bez tego `createEmailSender` zwraca błąd — wcześniej API i tak zwracało **HTTP 201** z `status: "failed"`, więc UI wyglądał jak sukces. Od poprawki w tym repozytorium nieudana wysyłka to **HTTP 502** z polem `error` w JSON; w panelu zobaczysz treść błędu zamiast milczącego „nic nie poszło”.

**Pierwsze konto:** wejdź na URL panelu i załóż konto administratora (jak w README saasmail).
