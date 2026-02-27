# Konfiguracja BillionMail z ContentVault

ContentVault wysyła maile przez SMTP. Możesz użyć **BillionMail** zamiast boky/postfix jako serwera pocztowego. BillionMail to open-source (AGPL), self-hosted, bez miesięcznych opłat.

## Architektura

```
ContentVault API → BillionMail Postfix (port 587) → [opcjonalnie relay] → Internet
```

BillionMail może:
- **Wysyłać bezpośrednio** (port 25, wymaga otwartego IP i DNS: SPF, DKIM, DMARC)
- **Używać zewnętrznego relay** (np. Resend darmowy plan, Gmail, AWS SES) – lepsza dostarczalność

---

## Krok 1: Instalacja BillionMail

### Metoda A: Docker (zalecana)

```bash
cd /opt
git clone https://github.com/aaPanel/BillionMail
cd BillionMail
cp env_init .env
# Edytuj .env – min. DBNAME, DBUSER, DBPASS, BILLIONMAIL_HOSTNAME (np. mail.twojadomena.pl)
docker compose up -d
```

### Metoda B: Skrypt instalacyjny

```bash
cd /opt
git clone https://github.com/aaPanel/BillionMail
cd BillionMail
bash install.sh
```

### Sprawdzenie

```bash
docker network ls | grep billion
# Powinna być: billionmail_billionmail-network
```

Panel web: `http://SERVER_IP:8880` lub `https://SERVER_IP:8443`.  
Domyślne dane: `billion` / `billion` (lub sprawdź `./bm default` w `/opt/BillionMail`).  
Jeśli nie działa – **GCP Firewall** może blokować porty 8880 i 8443. Dodaj regułę: TCP 8880, 8443.

---

## Krok 2: Konfiguracja domeny w BillionMail

1. Zaloguj się do panelu BillionMail.
2. **Connect Your Domain** → dodaj domenę (np. `twojadomena.pl`).
3. Skonfiguruj rekordy DNS (MX, SPF, DKIM, DMARC) – BillionMail pokaże dokładne wartości.
4. Zweryfikuj domenę.

### Opcja A: Wysyłka bezpośrednia (bez relay)

- Port 25 musi być otwarty na firewallu.
- IP serwera nie może być na czarnych listach.
- Wymaga poprawnego SPF/DKIM/DMARC.

### Opcja B: Zewnętrzny relay (np. Resend)

1. Załóż konto na [Resend](https://resend.com) (darmowy plan: 3000 maili/mies.).
2. W BillionMail: **SMTP Relay** → **Custom SMTP**:
   - Host: `smtp.resend.com`
   - Port: `587`
   - Username: `resend`
   - Password: Twój klucz API Resend (`re_xxx...`)
3. Przypisz relay do domeny.
4. Przetestuj połączenie.

---

## Krok 3: Połączenie ContentVault z BillionMail

### 3a. Ustaw zmienne w `.env` ContentVault

```env
# SMTP — wskazanie na BillionMail Postfix
SMTP_HOST=postfix
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@twojadomena.pl
SMTP_HOSTNAME=mail.twojadomena.pl
SMTP_ALLOWED_DOMAINS=twojadomena.pl
```

Gdy używasz BillionMail, **nie** ustawiaj `RESEND_API_KEY` – ContentVault korzysta wyłącznie z SMTP.

### 3b. Uruchom ContentVault z override BillionMail

```bash
cd /opt/contentvault   # lub Twoja ścieżka do ContentManager
docker compose -f docker-compose.yml -f docker-compose.billionmail.yml up -d
```

Override łączy API z siecią BillionMail i ustawia `SMTP_HOST=postfix`, `SMTP_PORT=587`.

### 3c. Inna nazwa sieci BillionMail

Jeśli sieć ma inną nazwę:

```bash
docker network ls | grep billion
```

Edytuj `docker-compose.billionmail.yml` i zmień `name:` w sekcji `networks.billionmail`.

### 3d. Konfiguracja BillionMail dla ContentVault (wymagana)

ContentVault API łączy się z Postfixem przez sieć Docker. Potrzebne są dwie zmiany na serwerze BillionMail:

**1. Postfix – dodaj sieć ContentVault do mynetworks** (w przeciwnym razie: „Client host rejected”)

```bash
# Na VPS, w /opt/BillionMail/conf/postfix/main.cf znajdź:
# mynetworks = 127.0.0.0/8 ...
# Zamień na (dodaj 172.66.1.0/24):
mynetworks = 127.0.0.0/8 [::ffff:127.0.0.0]/104 [::1]/128 172.66.1.0/24
```

Potem: `cd /opt/BillionMail && docker compose restart postfix-billionmail`

**2. Rspamd – wyłącz greylist dla wewnętrznego relay** (inaczej: „4.7.1 Try again later”)

Utwórz plik `/opt/BillionMail/conf/rspamd/local.d/settings.conf`:

```conf
# Bypass greylist for ContentVault API (internal relay from Docker network)
internal_relay {
  ip = "172.66.1.0/24";
  apply {
    symbols_disabled = ["GREYLIST_CHECK", "GREYLIST_SAVE"];
  }
}
```

Potem: `cd /opt/BillionMail && docker compose restart rspamd-billionmail`

---

## Szablony kampanii email

W folderze `docs/email-templates/` znajdziesz gotowe szablony w stylu ContentVault:
- **Newsletter welcome** – powitanie subskrybentów
- **Nowe treści** – informacja o nowych modelach/zdjęciach
- **Promocja** – oferty, zniżki, kody rabatowe
- **Re-engagement** – do nieaktywnych użytkowników

Każdy ma footer z linkiem do wypisania. Szczegóły: `docs/email-templates/README.md`.

---

## Krok 4: Testowanie

1. **Forgot password** – wpisz email użytkownika z bazy.
2. **Rejestracja** – utwórz nowe konto.

Sprawdź maile w skrzynce (również SPAM). Logi BillionMail: `docker compose -f /opt/BillionMail/docker-compose.yml logs postfix-billionmail`.

---

## Przebudowa od zera (zachowanie bazy)

Aby zatrzymać wszystkie kontenery, usunąć cache (Redis) i przebudować od zera **zachowując PostgreSQL**:

```bash
cd /opt/contentvault   # lub Twoja ścieżka
bash scripts/vps-rebuild.sh
```

Z BillionMail:

```bash
bash scripts/vps-rebuild.sh --billionmail
```

Z lokalnego PC (sync + rebuild na VPS):

```bash
./scripts/deploy-vps.sh --rebuild
# lub z BillionMail:
./scripts/deploy-vps.sh --rebuild --billionmail
```

---

## Troubleshooting

| Problem | Rozwiązanie |
|---------|-------------|
| API nie startuje | Sprawdź, czy sieć `billionmail_billionmail-network` istnieje. |
| „Connection refused” do postfix | Upewnij się, że BillionMail działa: `docker compose -f /opt/BillionMail/docker-compose.yml ps`. |
| „Client host rejected” (554) | Dodaj `172.66.1.0/24` do `mynetworks` w Postfix – patrz 3d. |
| „451 4.7.1 Try again later” | Rspamd greylist odrzuca. Dodaj `settings.conf` z bypassem dla 172.66.1.0/24 – patrz 3d. |
| Maile w SPAM | Zweryfikuj SPF, DKIM, DMARC. Rozważ relay (Resend, SES). |
| TLS/certificate error | Mailer pomija weryfikację certyfikatu dla `postfix` (isLocalRelay). |
