# Konfiguracja BillionMail z ContentVault

ContentVault wysyła maile przez SMTP. Zamiast boky/postfix możesz użyć **BillionMail** jako serwera SMTP. BillionMail wymaga zewnętrznego **relaya** (np. Resend) do faktycznej dostawy maili.

## Schemat

```
ContentVault API → BillionMail Postfix → Resend SMTP → Internet
```

## Krok 1: Konfiguracja Resend jako relay w BillionMail

1. Zaloguj się do panelu BillionMail (np. https://mail.dyskiof.net)
2. **Connect Your Domain** → dodaj domenę `dyskiof.net` (jeśli jeszcze nie ma)
3. **SMTP Relay** → dodaj **Custom SMTP** z danymi Resend:
   - **SMTP Host:** `smtp.resend.com`
   - **Port:** `587`
   - **Username:** `resend`
   - **Password:** Twój klucz API Resend (np. `re_xxx...`)
4. Zapisz i przetestuj połączenie

## Krok 2: Połączenie ContentVault z BillionMail

BillionMail i ContentVault muszą być w tej samej sieci Docker.

### 2a. Sprawdź nazwę sieci BillionMail

Na VPS:
```bash
docker network ls | grep -i billion
```

Typowy wynik: `billionmail_billionmail-network` (jeśli folder to `BillionMail` i compose ma `name: billionmail`).

### 2b. Podłącz ContentVault API do sieci BillionMail

```bash
docker network connect billionmail_billionmail-network content-api
```

(Lub użyj dokładnej nazwy z kroku 2a.)

### 2c. Ustaw zmienne w .env ContentVault

```env
# Wyłącz Resend API – używamy SMTP przez BillionMail
# RESEND_API_KEY=

# Wskaż na Postfix BillionMail (hostname w sieci BillionMail)
SMTP_HOST=postfix
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@dyskiof.net
SMTP_HOSTNAME=mail.dyskiof.net
SMTP_ALLOWED_DOMAINS=dyskiof.net
```

### 2d. Restart API

```bash
cd /opt/contentvault
docker compose up -d api
```

## Krok 3: Użycie override (zalecane)

Zamiast `docker network connect` użyj pliku override:

```bash
cd /opt/contentvault
docker compose -f docker-compose.yml -f docker-compose.billionmail.yml up -d
```

Jeśli nazwa sieci BillionMail jest inna (sprawdź `docker network ls | grep billion`), edytuj `docker-compose.billionmail.yml` i zmień `name:`.

## Krok 4: Wyłącz Resend API

Gdy używasz BillionMail przez SMTP, usuń lub zakomentuj `RESEND_API_KEY` w `.env`, aby mailer korzystał z SMTP:

```env
# RESEND_API_KEY=   # wyłączone – używamy BillionMail SMTP
SMTP_HOST=postfix
SMTP_PORT=587
```

## Testowanie

1. **Forgot password** – wpisz email użytkownika z bazy
2. **Rejestracja** – załóż nowe konto

Maile powinny być dostarczane przez Resend (sprawdź też skrzynkę SPAM).
