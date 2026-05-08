# Audyt: Ukrycie Origin IP i powiązania z domeną dyskiof.net

**Data:** 2026-02-27  
**Cel:** Nie ujawniać origin IP nigdzie; uniemożliwić powiązanie origin IP z domeną dyskiof.net.

---

## 1. Wyniki audytu

### DNS (Cloudflare API)

| Rekord | Typ | Content | Proxied |
|--------|-----|---------|---------|
| dyskiof.net | A | 136.114.88.152 | **Tak** |
| www.dyskiof.net | CNAME | dyskiof.net | **Tak** |

**Status:** OK – publiczny DNS zwraca IP Cloudflare, nie origin.

---

### Bezpośrednie połączenie na origin IP

**Test:** Połączenie na `136.114.88.152:443` z `Host: dyskiof.net`

| Wynik |
|-------|
| Serwer odpowiada i prezentuje **certyfikat SSL z CN=dyskiof.net** |

**Status:** KRYTYCZNE – Censys, Shodan i każdy skaner może:
1. Połączyć się z IP
2. Odebrać certyfikat z domeną dyskiof.net
3. Zindeksować powiązanie IP ↔ domena

---

### SPF (TXT dyskiof.net)

```
v=spf1 include:amazonses.com -all
```

**Status:** OK – brak `ip4:` z IP VPS. Email przez Amazon SES.

---

### MX / Email

- `send.dyskiof.net` MX → `feedback-smtp.eu-west-1.amazonses.com`
- Maile wysyłane przez Cloudflare Email API – nie z VPS (brak Postfix na origin)

**Status:** OK – nagłówki Received nie ujawnią IP VPS.

---

### Aplikacja (kod)

- Brak hardkodowanego IP 136.114.88.152
- `streamingBaseURL` używa `FRONTEND_URL` lub Host z requestu – OK
- Fallback `dyskiof.net` tylko gdy Host pusty – OK

**Status:** OK.

---

### Nginx (default server)

- `ssl_reject_handshake on` + `return 444` dla `server_name _`
- Działa tylko gdy Host **nie** pasuje do dyskiof.net
- Gdy Censys wysyła `Host: dyskiof.net` lub SNI – trafia do main server i **zwraca pełny certyfikat**

**Status:** Nginx nie chroni przed skanowaniem z Host: dyskiof.net.

---

## 2. Plan naprawczy

### Priorytet 1: Firewall – tylko Cloudflare na 80/443

**Skrypt:** `scripts/vps-cloudflare-firewall.sh`

Na VPS:
```bash
sudo ./scripts/vps-cloudflare-firewall.sh
```

Efekt: Połączenia spoza Cloudflare na porty 80/443 zostaną odrzucone. Censys nie dostanie odpowiedzi → brak certyfikatu → brak powiązania.

---

### Priorytet 2: Ograniczenie SSH (22)

Firewall nie blokuje SSH. Opcje:
- Ogranicz w GCP Firewall do swojego IP
- Lub zostaw (używaj kluczy SSH, fail2ban)

---

## 3. Weryfikacja po wdrożeniu

1. **Z zewnątrz (np. telefon bez WiFi):**
   ```bash
   curl -v --connect-timeout 5 http://136.114.88.152/
   ```
   Oczekiwane: timeout lub connection refused.

2. **Z Cloudflare (przez domenę):**
   ```bash
   curl -I https://dyskiof.net/
   ```
   Oczekiwane: 200 OK.

3. **Censys:** Po ~24–48 h sprawdź https://search.censys.io/hosts/136.114.88.152 – porty 80/443 nie powinny być widoczne.

---

## 4. Podsumowanie

| Źródło wycieku | Status | Działanie |
|----------------|--------|-----------|
| DNS | OK | Proxied |
| SPF | OK | Brak ip4 |
| Email | OK | Cloudflare Email API (bez serwera SMTP na origin) |
| Kod | OK | Brak IP |
| **Direct IP + SSL cert** | **KRYTYCZNE** | **Firewall** |

**Jedyna skuteczna ochrona:** Firewall – tylko IP Cloudflare na 80/443.
