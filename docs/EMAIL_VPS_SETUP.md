# Wysyłka e-mail z VPS (Cloudflare Email Service)

Backend może wysyłać maile na jeden z trzech sposobów (pierwszy dopasowany wygrywa):

1. **Saasmail** — `POST` na `SAASMAIL_SEND_URL` z `SAASMAIL_API_KEY` (treść trafia do panelu Saasmail).
2. **Cloudflare Email Service** — HTTPS ([REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)) przy ustawionej parze `CLOUDFLARE_EMAIL_*`.
3. **SMTP** — gdy ustawiony `SMTP_HOST`.

Nie ma kontenera Postfix ani Resend, o ile nie włączysz SMTP.

## Wymagane zmienne w `.env` na VPS (Cloudflare REST)

```bash
CLOUDFLARE_EMAIL_ACCOUNT_ID=   # Account ID z Cloudflare Overview
CLOUDFLARE_EMAIL_API_TOKEN=    # API token z uprawnieniem Email Sending → Send
SMTP_FROM=noreply@twojadomena.pl   # Adres z domeny dodanej do Email → Sending
```

Bez żadnej z powyższych ścieżek (Saasmail / Cloudflare / SMTP) API **pominie** wysyłkę (log: „Email not configured…”).

## Konfiguracja Cloudflare

1. **Email → Sending** — dodaj domenę i dokończ rekordy DNS (SPF/DKIM z kreatora).
2. **Manage Account → API Tokens → Create Token** — uprawnienia do wysyłki e-mail dla konta (wg szablonu „Send Email” / dokumentacji Email Service).
3. Upewnij się, że `SMTP_FROM` używa **zweryfikowanej** domeny nadawcy.

## Diagnostyka

Po próbie wysłki (np. forgot password) sprawdź logi API:

```bash
docker compose -f docker-compose.yml -f docker-compose.vps.yml logs content-api --tail=80 | grep -i Mailer
```

Typowe błędy:

- `403` / sending disabled — domena nie w Sending lub token bez uprawnień.
- `400` / invalid — zły format adresu lub brak pola w JSON (sprawdź `SMTP_FROM`).

## Skrypt pomocniczy

```bash
bash scripts/vps-fix-email.sh .env "$CLOUDFLARE_EMAIL_ACCOUNT_ID" "$CLOUDFLARE_EMAIL_API_TOKEN"
```

## Opcja deweloperska: SMTP

Możesz ustawić `SMTP_HOST` (np. Mailpit) **zamiast** pary Cloudflare — wtedy backend użyje ścieżki SMTP. Na produkcji VPS standardem jest Cloudflare.

## Wysyłka przez Saasmail (jedna skrzynka w panelu)

Jeśli chcesz, żeby maile transakcyjne z backendu **pojawiały się w Saasmail** (wątek / „sent”):

```bash
SAASMAIL_SEND_URL=https://<twój-worker>/api/send
SAASMAIL_API_KEY=sk_…        # z Saasmail → API (Bearer); użytkownik musi mieć passkey przed wygenerowaniem klucza
SMTP_FROM=noreply@twojadomena.pl   # ten sam adres musi istnieć jako **Inbox** w Saasmail i być dozwolony dla klucza
```

Gdy `SAASMAIL_SEND_URL` i `SAASMAIL_API_KEY` są ustawione, backend **nie** woła już `CLOUDFLARE_EMAIL_*` do wysyłki (Saasmail i tak użyje Cloudflare Email Sending po swojej stronie, jeśli worker ma binding `EMAIL`).

## Panel zespołowy (saasmail)

Osobny inbox na Workers — submoduł w repozytorium: **[`docs/SAASMAIL.md`](SAASMAIL.md)**.
