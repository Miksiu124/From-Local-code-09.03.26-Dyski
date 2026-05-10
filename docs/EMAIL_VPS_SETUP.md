# Wysyłka e-mail z VPS (Resend)

Backend wysyła maile w tej kolejności:

1. **Resend** — HTTPS [API](https://resend.com/docs/api-reference/emails/send-email) przy ustawionym `RESEND_API_KEY` i `SMTP_FROM` (nadawca z zweryfikowanej domeny w Resend).
2. **SMTP** — gdy ustawiony `SMTP_HOST` (zwykle lokalnie / Mailpit). Użyj pustego `RESEND_API_KEY`, aby wymusić tylko SMTP.

## Wymagane zmienne w `.env` na VPS (Resend)

```bash
RESEND_API_KEY=re_...          # klucz API z panelu Resend
SMTP_FROM=noreply@twojadomena.pl   # adres z domeny zweryfikowanej w Resend
```

Opcjonalnie osobny nadawca dla kampanii marketingowych (wbudowane szablony w API):

```bash
# MARKETING_EMAIL_FROM=newsletter@twojadomena.pl
```

Bez **Resend** ani **SMTP** API **pominie** wysyłkę (log: „Email not configured…”).

## Konfiguracja Resend

1. Utwórz konto i domenę w [Resend](https://resend.com) — ukończ rekordy DNS (SPF/DKIM z instrukcji).
2. Wygeneruj API key (Sending access).
3. Upewnij się, że `SMTP_FROM` i ewentualny `MARKETING_EMAIL_FROM` są **dozwolonymi** adresami dla tej domeny.

## Diagnostyka

Po próbie wysłki (np. forgot password) sprawdź logi API:

```bash
docker compose -f docker-compose.yml -f docker-compose.vps.yml logs content-api --tail=80 | grep -i Mailer
```

Typowe błędy:

- `422` / validation — zły format adresu lub nadawca spoza zweryfikowanej domeny (sprawdź `SMTP_FROM` w Resend).
- `401` / `403` — nieprawidłowy lub odwołany `RESEND_API_KEY`.

## Skrypt pomocniczy

```bash
bash scripts/vps-fix-email.sh .env "$RESEND_API_KEY"
```

(opcjonalnie trzeci argument: ścieżka inna niż `.env`)

## Opcja deweloperska: SMTP

Możesz ustawić `SMTP_HOST` (np. Mailpit) **zamiast** Resend — wtedy backend użyje ścieżki SMTP (ustaw **`RESEND_API_KEY` pusty**). Na produkcji VPS standardem jest Resend.

## Usunięcie starego workera e-mail (np. Saasmail) w Cloudflare

Repozytorium nie utrzymuje już tego kodu — zasoby w Cloudflare **trzeba usunąć ręcznie** na koncie, gdzie były wdrożone.

### 1. Email Routing (koniecznie najpierw)

W [Email → Email Routing](https://dash.cloudflare.com/) dla domeny:

- Otwórz **Routing rules** i **usuń lub wyłącz** reguły typu *Send to Worker* wskazujące na starego workera (np. `saasmail-dyskiof`).
- Bez tego część adresów może nadal próbować trafiać w nieistniejący worker.

### 2. Worker

- **Panel:** Workers & Pages → wybierz workera → **Manage service** → usuń (lub odpowiednik w aktualnym UI).
- **CLI** (po `npx wrangler login` na koncie docelowym), nazwa musi być **dokładnie** taka jak w dashboardzie:

```bash
npx wrangler delete --name saasmail-dyskiof
```

Opcjonalnie najpierw sprawdź: `npx wrangler delete --dry-run --name saasmail-dyskiof`.

### 3. Pozostałe zasoby (opcjonalnie, tylko jeśli ich nigdzie indziej nie używasz)

Typowe nazwy z wdrożenia Saasmail (dostosuj do listy w swoim koncie):

- **D1:** `wrangler d1 list` → `wrangler d1 delete <nazwa-bazy>`
- **R2:** `wrangler r2 bucket list` → `wrangler r2 bucket delete <bucket>` (**bez odzysku danych**)
- **Queues:** `wrangler queues list` → `wrangler queues delete <kolejka>`

### 4. Domeny routingu

Jeśli podpiołeś **custom domain** pod URL panelu (np. `mail.domena.pl`), usuń route / odłącz domenę od workera w konfiguracji Workers, żeby nie zostawić „martwego” powiązania.

### 5. Email Service (beta) przy Cloudflare

Jeśli włączałeś **Email → Sending** wyłącznie pod Saasmail, możesz tam wyłączyć domenę nadawczą / wysyłkę według potrzeb — **transakcyjna wysyłka Dyskiof idzie przez Resend**, nie przez ten worker.
