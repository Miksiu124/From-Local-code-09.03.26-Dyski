# Plan wizualizacji danych i alertów — Dyskiof ContentManager

**Data:** 15 marca 2026  
**Autorzy:** Backend Architect, API Developer, SRE, Senior Project Manager  
**Źródła:** THREAT_DETECTION_REPORT, DATA_ENGINEERING_AUDIT, eksploracja codebase

---

## 1. Executive Summary

| Obszar | Stan obecny | Rekomendacja |
|--------|-------------|--------------|
| **Dane biznesowe** | Admin analytics (agregaty) | ✅ Wizualizacja w `/admin/analytics` — rozszerzyć o trendy czasowe |
| **Bezpieczeństwo** | Eventy JSON do stdout | ❌ Brak SIEM — dodać Logpush + dashboard + alerty |
| **API / serwisy** | Brak metryk | ❌ Brak Prometheus/StatsD — dodać health, latency, error rate |
| **Użytkownicy / sesje** | Dane w DB | ⚠️ Częściowo — dodać dashboard aktywności + anomalie |
| **Infrastruktura** | Health check tylko | ❌ Brak alertów na R2 sync, DB, Redis |

---

## 2. Co przechwytujemy — inwentaryzacja

### 2.1 Dane biznesowe (PostgreSQL)

| Tabela / źródło | Dane | Użycie |
|-----------------|------|--------|
| `users` | total, new 7d/30d, credits, country | Admin analytics |
| `credit_purchases` | status, method, amount | Revenue, konwersja |
| `purchases` | bundles vs individual | Top sellers |
| `referral_link_visits` | referrer_id, ip, user_agent, referer, variant, created_at | Referral analytics |
| `link_visits` | custom_link_id, ip, user_agent, referer, created_at | Custom link analytics |
| `sessions` | userId, deviceInfo, ipAddress, userAgent, expires | Sesje, device fingerprint |
| `models` | last_synced_at, is_active | Freshness contentu |
| `content_items` | model_id, paths R2 | Orphan detection |

### 2.2 Eventy bezpieczeństwa (stdout, JSON)

| Event | Źródło | Pola |
|-------|--------|------|
| `auth.login.failed` | Go auth handler | ts, ip, path, email_hash |
| `auth.login.rate_limited` | Go auth handler | ts, ip, path, limit_type, email_hash |
| `auth.register.rate_limited` | Go auth handler | ts, ip, path, limit_type |
| `auth.forgot.rate_limited` | Go auth handler | ts, ip, path |
| `auth.reset.rate_limited` | Go auth handler | ts, ip, path |
| `csrf.blocked` | Next.js middleware | ts, ip, path |
| `ratelimit.hit` | Next.js middleware | ts, ip, path |

**Brakujące (THREAT_DETECTION):** `access.denied`, `admin.action`

### 2.3 Błędy i telemetria

| Źródło | Dane | Przechowywanie |
|--------|------|---------------|
| Sentry | Client-side errors | Sentry (jeśli SENTRY_DSN) |
| Go `log.Printf` | Błędy sync, Discord, mailer, R2 | stdout |
| Next.js `logger.error` | Błędy fetch, UI | console + Sentry |

### 2.4 Zewnętrzne serwisy

| Serwis | Dane | Monitoring |
|--------|------|------------|
| Cloudflare R2 | Obiekty, sync status | Brak |
| Redis | Sesje, rate limit | Brak |
| PostgreSQL | Wszystkie dane | Brak |
| Discord OAuth | Login flow | Brak |
| Cloudflare Turnstile | CAPTCHA | Brak |

---

## 3. Gdzie wizualizować — mapa dashboardów

### 3.1 Admin Panel (istniejący) — `/admin/analytics`

**Obecnie:** StatCards (revenue, users, credits, models, purchases, top sellers, referral).

**Rozszerzenia:**

| Widok | Dane | Priorytet |
|-------|------|-----------|
| **Trendy czasowe** | Revenue 7d/30d (wykres liniowy), nowi użytkownicy (słupki) | Wysoki |
| **Konwersja funnel** | Link visits → Registrations → Purchases (per custom link) | Średni |
| **Referral performance** | Clicks/registrations/revenue per referrer (tabela + sortowanie) | Średni |
| **Content freshness** | `last_synced_at` per model — flagi „stale” (>24h) | Wysoki |
| **Sesje aktywne** | Liczba sesji w Redis (jeśli endpoint) | Niski |

### 3.2 Nowy: Security & Ops Dashboard (zewnętrzny)

**Lokalizacja:** Grafana / Datadog / Cloudflare Dashboard (po integracji Logpush).

| Widok | Źródło danych | Metryki |
|-------|--------------|---------|
| **Auth failures** | `auth.login.failed` | Count per IP, per 5m; top IPs |
| **Rate limit abuse** | `auth.*.rate_limited`, `ratelimit.hit` | Count per IP per 1h |
| **CSRF attempts** | `csrf.blocked` | Count (alert na każdy) |
| **Admin actions** | `admin.action` (do implementacji) | Kto, co, kiedy |
| **BOLA / 403** | `access.denied` (do implementacji) | Count per IP per 5m |

### 3.3 Nowy: API & Services Health

| Widok | Źródło | Metryki |
|-------|--------|---------|
| **Health** | `/health` | Uptime, latency |
| **API latency** | Middleware / reverse proxy | p50, p95, p99 per endpoint |
| **Error rate** | 4xx, 5xx | Count per endpoint |
| **R2 sync** | `jobs/scheduler.go` | Last run, success/fail |
| **DB connections** | pgxpool | Active, idle |
| **Redis** | PING | Latency, connected clients |

### 3.4 Nowy: User Activity (opcjonalny)

| Widok | Dane | Użycie |
|-------|------|--------|
| **Sesje per user** | `sessions` | Wykrywanie multi-device, anomalie |
| **Geo distribution** | `sessions.ipAddress` → GeoIP | Heatmap |
| **Device mix** | `sessions.userAgent` | Desktop vs mobile |

---

## 4. Alerty — rekomendacje

### 4.1 Krytyczne (P0)

| Alert | Warunek | Kanał | Runbook |
|-------|---------|-------|---------|
| **Brute force login** | >15 `auth.login.failed` z tego samego IP w 5 min | Slack/PagerDuty | Sprawdź IP, rozważ blocklist |
| **Auth rate limit abuse** | Ten sam IP 3+ `auth.login.rate_limited` w 1h | Slack | Sprawdź czy atak, rozważ blocklist |
| **R2 sync failure** | SyncR2 zwraca błąd | Slack | Sprawdź R2 credentials, sieć |
| **Health down** | `/health` nie odpowiada 2 min | PagerDuty | Restart serwisu, sprawdź logi |
| **DB unreachable** | Connection timeout | PagerDuty | Sprawdź PostgreSQL, connection pool |

### 4.2 Wysokie (P1)

| Alert | Warunek | Kanał |
|-------|---------|-------|
| **CSRF attempt** | Każdy `csrf.blocked` | Slack |
| **Content freshness** | `last_synced_at` > 24h dla aktywnego modelu | Slack |
| **BOLA enumeration** | >10 `access.denied` z tego samego IP w 5 min | Slack |
| **Admin high-risk action** | BanUser, UpdateUser(role), UpdateSettings | Slack |

### 4.3 Średnie (P2)

| Alert | Warunek | Kanał |
|-------|---------|-------|
| **API error spike** | 5xx > 10/min | Slack |
| **Redis down** | PING timeout | Slack |
| **Promo abuse** | Ten sam promo code > N redemptions z tego samego IP | Slack |

---

## 5. Architektura — gdzie co umieścić

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ŹRÓDŁA DANYCH                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  Next.js (middleware)     Go backend            PostgreSQL    Redis     │
│  • csrf.blocked           • auth.* events       • users       • sessions │
│  • ratelimit.hit          • (future) admin      • purchases   • rate     │
│  • logger.error           • access.denied       • link_visits │          │
│  • Sentry                 • log.Printf          • sessions    │          │
└──────┬─────────────────────────┬──────────────────┬──────────┬─────────┘
       │                         │                  │          │
       ▼                         ▼                  ▼          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    AGRREGACJA / TRANSPORT                                │
├─────────────────────────────────────────────────────────────────────────┤
│  • Cloudflare Logpush (stdout → R2/Datadog)                              │
│  • Prometheus exporter (Go) — opcjonalnie                               │
│  • Sentry (errors)                                                      │
│  • Admin API (agregaty z DB)                                            │
└──────┬─────────────────────────┬──────────────────┬────────────────────┘
       │                         │                  │
       ▼                         ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    WIZUALIZACJA                                          │
├─────────────────────────────────────────────────────────────────────────┤
│  /admin/analytics (Next.js)     Grafana / Datadog      Sentry             │
│  • Biznes (revenue, users)     • Security events      • Errors           │
│  • Content freshness           • API latency          • Performance       │
│  • Referral, custom links      • Health, R2, DB       • Releases          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Opcje integracji (krótko)

| Narzędzie | Koszt | Zalety | Wady |
|-----------|-------|--------|------|
| **Cloudflare Logpush** | W zależności od planu | Natywne dla CF, R2, Workers | Wymaga CF przed frontem |
| **Datadog** | Płatne | Logi + metryki + APM w jednym | Koszt |
| **Grafana Cloud** | Freemium | Open source, elastyczne | Wymaga Loki/Prometheus |
| **Sentry** | Freemium | Już używane (errors) | Głównie errors, nie logi |
| **Self-hosted (Loki + Prometheus + Grafana)** | Infra | Pełna kontrola | Operacyjnie ciężkie |

**Rekomendacja:** Cloudflare Logpush → R2 lub Datadog (jeśli budżet). Dla metryk API — Prometheus exporter w Go lub middleware z exportem do StatsD/Datadog.

---

## 6. Plan implementacji (fazy)

### Faza 1: Uzupełnienie eventów (1–2 tyg.)

| # | Zadanie | Owner |
|---|---------|-------|
| 1 | Emit `access.denied` przy 403 na content/admin | Backend |
| 2 | Emit `admin.action` dla wszystkich admin API | Backend |
| 3 | Endpoint `GET /api/admin/health` (opcjonalnie) — DB, Redis, R2 ping | Backend |

### Faza 2: Log shipping (2–3 tyg.)

| # | Zadanie | Owner |
|---|---------|-------|
| 4 | Skonfigurować Cloudflare Logpush lub Datadog agent | Infra/SRE |
| 5 | Parsowanie `[SECURITY]` JSON w pipeline | Infra |
| 6 | Zapewnić, że Next.js stdout też trafia do logów | Infra |

### Faza 3: Dashboardy (2–3 tyg.)

| # | Zadanie | Owner |
|---|---------|-------|
| 7 | Rozszerzyć `/admin/analytics` o trendy czasowe, content freshness | Frontend |
| 8 | Dashboard Security (auth failures, rate limits, CSRF) | SRE |
| 9 | Dashboard Health (API, DB, Redis, R2 sync) | SRE |

### Faza 4: Alerty (1–2 tyg.)

| # | Zadanie | Owner |
|---|---------|-------|
| 10 | Reguły detekcji (brute force, rate limit abuse) | SRE |
| 11 | Integracja Slack / PagerDuty | SRE |
| 12 | Runbooki dla P0 alertów | PM/SRE |

---

## 7. Podsumowanie — co gdzie

| Kategoria | Gdzie wizualizować | Alerty |
|-----------|--------------------|--------|
| **Biznes (revenue, users, konwersja)** | `/admin/analytics` | — |
| **Content freshness** | `/admin/analytics` + nowa sekcja | Slack: last_synced > 24h |
| **Bezpieczeństwo (auth, CSRF, rate limit)** | Grafana/Datadog Security dashboard | Slack/PagerDuty |
| **API health, latency, errors** | Grafana/Datadog Ops dashboard | PagerDuty |
| **R2, DB, Redis** | Ten sam Ops dashboard | PagerDuty |
| **Błędy aplikacji** | Sentry | Sentry alerts |
| **Admin actions** | Grafana/Datadog (po `admin.action`) | Slack na high-risk |

---

## 8. Referencje

- [THREAT_DETECTION_REPORT_2026-03.md](./THREAT_DETECTION_REPORT_2026-03.md) — eventy, reguły detekcji
- [DATA_ENGINEERING_AUDIT_2026-03.md](./DATA_ENGINEERING_AUDIT_2026-03.md) — freshness, R2 sync
- [REMEDIATION_PLAN.md](./REMEDIATION_PLAN.md) — performance, UX
- `src/lib/security-events.ts` — Next.js security events
- `backend/internal/security/events.go` — Go security events
