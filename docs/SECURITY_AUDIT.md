# Audyt bezpieczeństwa – ContentVault VPS

Ostatni przegląd: 2025-02-27

---

## 🛡️ Ukrywanie IP originu (anti-DDoS)

**Cel:** Cały ruch ma iść przez Cloudflare. Origin IP nie może być wykrywalny (DNS, SPF, repo).

### Nginx (już zrobione)
- `server_tokens off`
- **Default server** (`server_name _`): `ssl_reject_handshake on` + `return 444` – zapytania po IP kończą się bez odpowiedzi (brak handshake SSL, brak wycieku)
- Blokada na poziomie TLS – atakujący nie uzyska sensownej odpowiedzi

### DNS – Cloudflare (sprawdź ręcznie)
- **A/AAAA** dla `dyskiof.net`, `www.dyskiof.net` → **Proxied (pomarańczowa chmurka)**. Jeśli DNS-only – `dig dyskiof.net` ujawni IP!
- Żadna subdomena nie może mieć DNS-only wskazującego na origin IP

### SPF – krytyczne
- SPF w TXT dla `dyskiof.net` **nie może** zawierać `ip4:XXX.XXX.XXX.XXX` (IP twojego VPS) – to publiczny wyciek.
- Używaj Resend: `v=spf1 include:amazonses.com -all` (bez ip4)
- Sprawdź: `dig TXT dyskiof.net` – nie powinno być tam IP VPS

### Repo
- Skrypty deploy: `VPS_HOST` wymagane w env, brak domyślnego IP
- README: brak hosta/IP

### MX
- Jeśli MX wskazuje na hosta na twoim VPS – `dig MX dyskiof.net` może ujawnić IP. Używaj zewnętrznego dostawcy (Resend, Google Workspace itd.) lub subdomeny z Proxied.

---

## ✅ Co jest w porządku

### Aplikacja i Docker
- **CORS** – dozwolone tylko `FrontendURL` z configu (+ localhost w dev)
- **Usługi wewnętrzne** – API, frontend, Postgres, Redis na `127.0.0.1`; dostęp tylko przez nginx
- **Secrets** – `.env` w `.gitignore`, nie powinien być commitowany
- **Nginx** – `ssl_reject_handshake on` dla zapytań po IP (brak odpowiedzi); Cloudflare Origin Pulls `optional`
- **Nagłówki bezpieczeństwa** – CSP, X-Frame-Options, HSTS, Referrer-Policy
- **TLS** – tylko TLS 1.2/1.3, sensowne cipher suites

### DNS/Email
- SPF, DKIM, DMARC dla domeny (dyskiof.net)
- Port 25 zablokowany na GCP – wysyłka przez Resend relay

---

## ⚠️ Zalecenia / ryzyka

### 1. **BillionMail – porty panelu (8443, 8880) otwarte na 0.0.0.0**

Porty panelu webowego BillionMail są dostępne publicznie. Ryzyko: brute force, próby logowania.

**Rekomendacja:** Ograniczenie dostępu w GCP Firewall do zaufanych IP (np. Twój domowy IP):

- W Google Cloud Console → VPC → Firewall
- Dla reguł dotyczących portów 8443, 8880 zmień `Source IP ranges` z `0.0.0.0/0` na np. `TWOJ_IP/32`

### 2. **BillionMail – IMAP/POP (110, 143, 993, 995), SMTP (25, 465, 587) na 0.0.0.0**

Porty pocztowe są nasłuchiwane. Jeśli korzystasz tylko z webmaila i relayu – IMAP/POP mogą nie być potrzebne publicznie.

**Rekomendacja:** W GCP Firewall zostaw otwarte tylko porty faktycznie używane (np. 25, 587 jeśli używasz relay). IMAP/POP można ograniczyć do prywatnych sieci lub wyłączyć, jeśli nie używasz.

### 3. **Dane wrażliwe w repozytorium**

Skrypty deploy wymagają `VPS_HOST` w env (bez domyślnego IP). README nie ujawnia hosta.

### 4. **test-contacts.csv**

`docs/email-templates/test-contacts.csv` zawiera `dyskiof@proton.me`. Jeśli ten plik trafi do publicznego repo – adres email jest widoczny.

**Rekomendacja:** Użyj placeholderów w przykładowym pliku (`test@example.com`) lub dodaj `test-contacts.csv` do `.gitignore`, jeśli ma dane osobowe.

### 5. **NPM vulnerabilities w frontend** — WYKONANE

Wykonano `npm audit fix` i upgrade @aws-sdk/client-s3 do latest. Zostały 19 low-severity vulns.
Dodano Dependabot (`.github/dependabot.yml`) i `npm audit --audit-level=high` w CI.

### 6. **Deploy – .env nie powinien być w archiwum** — WYKONANE

Skrypt deployu (deploy-vps.sh) wyklucza `.env`. Dodano `.env` do `.dockerignore`, by uniknąć włączenia do obrazu Docker.

---

## Porty nasłuchujące na VPS (stan z audytu)

| Port   | Serwis        | Adres    | Uwagi                                   |
|--------|---------------|----------|-----------------------------------------|
| 22     | SSH           | 0.0.0.0  | Wymagany – zalecane: klucze SSH, wyłączenie hasła |
| 80, 443| Nginx         | 0.0.0.0  | Wymagane                                |
| 25     | Postfix       | 0.0.0.0  | Zablokowany na GCP; Resend relay        |
| 465, 587| SMTP         | 0.0.0.0  | BillionMail                             |
| 110, 143, 993, 995 | Dovecot | 0.0.0.0 | POP/IMAP BillionMail      |
| 8443, 8880 | Panel BillionMail | 0.0.0.0 | **Ryzyko** – ograniczyć IP             |
| 3000, 5432, 6379 | App | 127.0.0.1 | Tylko localhost – OK          |

---

## Checklist przed publikacją / udostępnieniem repo

- [ ] Ograniczyć porty 8443, 8880 w GCP Firewall do zaufanych IP
- [x] Sprawdzić `npm audit` w frontend — w CI, Dependabot dodany
- [ ] Usunąć/zastąpić prawdziwe dane z `test-contacts.csv`
- [x] Upewnić się, że deploy nie synchronizuje `.env` z lokalnego na serwer

## Zmiany z audytu bezpieczeństwa (2025-02-27)

- **JWT/session TTL:** domyślny skrócony z 30 do 7 dni
- **Retry-After:** dodany do odpowiedzi 429 (middleware, auth, credits)
- **CSP:** dodano object-src, base-uri, form-action
- **CodeQL SAST:** workflow `.github/workflows/codeql.yml`
- **DAST (OWASP ZAP):** workflow `.github/workflows/dast.yml`
- **RLS:** migracja 20260227120000_enable_rls na tabelach multitenant
- **Cookie banner:** komponent do zgody ePrivacy/GDPR
