# Maile na VPS – forgot password, welcome, płatności

Jeśli maile (przypomnienie hasła, powitanie, potwierdzenia płatności) nie docierają, sprawdź konfigurację SMTP na VPS.

---

## Szybka diagnoza

Na VPS sprawdź logi kontenera SMTP po próbie wysłania maila (np. forgot password):

```bash
docker compose logs content-smtp --tail=50
```

Typowe błędy:
- `Relay access denied` / `authentication failed` → brak lub błędny `SMTP_RELAY_PASSWORD`
- `Connection refused` → SMTP_HOST wskazuje na nieistniejący host
- Brak błędów w logach → sprawdź SPAM, SPF/DKIM

---

## Konfiguracja (boky/postfix + Resend)

ContentVault używa kontenera `content-smtp` (boky/postfix), który przekazuje maile przez Resend. **Wymagane zmienne w `.env` na VPS:**

```env
# Nadawca – musi być z Twojej domeny
SMTP_FROM=noreply@dyskiof.net
SMTP_HOSTNAME=mail.dyskiof.net
SMTP_ALLOWED_DOMAINS=dyskiof.net

# Resend relay – krytyczne dla dostarczalności
SMTP_RELAYHOST=[smtp.resend.com]:587
SMTP_RELAY_USERNAME=resend
SMTP_RELAY_PASSWORD=re_xxxxxxxxxxxxxxxx   # Twój klucz API z Resend
```

Bez `SMTP_RELAY_PASSWORD` postfix przyjmie maile od API, ale nie będzie mógł ich przekazać dalej.

---

## Jak uzyskać klucz Resend

1. Zaloguj się na [resend.com](https://resend.com)
2. API Keys → Create API Key
3. Skopiuj klucz (np. `re_123abc...`)
4. Dodaj go do `.env` na VPS jako `SMTP_RELAY_PASSWORD`

Darmowy plan: 3000 maili/mies.

---

## Po zmianie .env

```bash
cd /opt/contentvault
docker compose restart content-smtp content-api
```

---

## Opcja: BillionMail

Jeśli używasz BillionMail zamiast boky/postfix, zobacz `docs/BILLIONMAIL_SETUP.md`. Wymagane jest uruchomienie z override:

```bash
docker compose -f docker-compose.yml -f docker-compose.billionmail.yml up -d
```
