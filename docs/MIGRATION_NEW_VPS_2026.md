# Migracja na nowy VPS — 138.249.138.60 (2026-03-03)

## Status: Wdrożone i działające

Strona https://dyskiof.net działa na nowym VPS. Ruch przechodzi przez Cloudflare (CF-RAY w odpowiedzi).

### Wykonane

1. **VPS Setup** — użytkownik `deploy`, Docker, firewall Cloudflare-only (80/443)
2. **SSH** — klucze skopiowane, `ssh deploy@138.249.138.60` bez hasła
3. **Deploy** — kod zsynchronizowany, Docker Compose uruchomiony
4. **.env** — nowe secrety (JWT, AUTH, STREAMING, POSTGRES) + R2, Discord, Redis, Admin z lokalnego .env
5. **SSL** — certyfikaty self-signed (Cloudflare musi być w trybie **Full**, nie Full strict)
6. **Seed** — modele z R2, kraje przypisane
7. **DNS** — dyskiof.net zwraca IP Cloudflare (104.x, 172.x) — Proxied OK

### Do zrobienia ręcznie

#### 1. Cloudflare DNS — zmiana origin na nowy IP

Token API zwrócił 401 — zaktualizuj rekord w **Cloudflare Dashboard**:

- **DNS** → rekord A dla `dyskiof.net`
- **IPv4 address:** zmień na `138.249.138.60`
- **Proxied:** musi być włączone (pomarańczowa chmurka)

#### 2. Cloudflare SSL — tryb Full

Self-signed cert na origin wymaga trybu **Full**:

- **SSL/TLS** → Overview → **Full** (nie Full strict)

Albo wygeneruj **Cloudflare Origin Certificate** (15 lat) i zastąp self-signed.

#### 3. Let's Encrypt (opcjonalnie)

Token Cloudflare ma ograniczenie IP — nie działa z 138.249.138.60. Aby użyć Certbot DNS-01:

- Utwórz nowy token bez ograniczenia IP (Zone:DNS:Edit)
- Zaktualizuj `/opt/contentvault/certbot/cloudflare.ini` na VPS
- Uruchom certbot, zamień symlinki w nginx/certs

#### 4. Cloudflare Email (`CLOUDFLARE_EMAIL_*`)

Jeśli `.env.vps.new` ma placeholdery `PASTE_CLOUDFLARE_EMAIL_*` — wklej **Account ID** i **API token** (Email Sending) z Cloudflare, zgodnie z `docs/EMAIL_VPS_SETUP.md`:

```bash
ssh deploy@138.249.138.60
nano /opt/contentvault/.env
# CLOUDFLARE_EMAIL_ACCOUNT_ID=...  CLOUDFLARE_EMAIL_API_TOKEN=...
docker compose -f docker-compose.yml -f docker-compose.vps.yml restart content-api
```

### Weryfikacja prywatności

```bash
# DNS — musi zwracać Cloudflare IP
dig dyskiof.net +short

# Bezpośredni dostęp — powinien timeout/block
curl -v --connect-timeout 5 http://138.249.138.60/

# Przez domenę — 200 OK
curl -I https://dyskiof.net/
```

### .env.deploy (lokalnie)

```
VPS_HOST=138.249.138.60
VPS_USER=deploy
VPS_PATH=/opt/contentvault
```
