# Wysyłka e-mail z VPS (Cloudflare Email Service)

Backend wysyła maile w tej kolejności:

1. **Cloudflare Email Service** — HTTPS ([REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)) przy ustawionej parze `CLOUDFLARE_EMAIL_*` i `SMTP_FROM`.
2. **SMTP** — gdy ustawiony `SMTP_HOST` (zwykle lokalnie / Mailpit).

Nie ma kontenera Postfix ani Resend, o ile nie włączysz SMTP.

## Wymagane zmienne w `.env` na VPS (Cloudflare REST)

```bash
CLOUDFLARE_EMAIL_ACCOUNT_ID=   # Account ID z Cloudflare Overview
CLOUDFLARE_EMAIL_API_TOKEN=    # API token z uprawnieniem Email Sending → Send
SMTP_FROM=noreply@twojadomena.pl   # Adres z domeny dodanej do Email → Sending
```

Opcjonalnie osobny nadawca dla kampanii marketingowych (wbudowane szablony w API):

```bash
# MARKETING_EMAIL_FROM=newsletter@twojadomena.pl
```

Bez **Cloudflare REST** ani **SMTP** API **pominie** wysyłkę (log: „Email not configured…”).

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

## Panel zespołowy (opcjonalny submoduł saasmail)

Osobna aplikacja na Workers (tylko jeśli ją utrzymujesz) — **[`docs/SAASMAIL.md`](SAASMAIL.md)**. **Backend Dyskiof nie przekazuje już transakcji przez Saasmail** — tylko `CLOUDFLARE_EMAIL_*` lub SMTP.
