# Threat Detection Coverage Report — Dyskiof ContentManager

**Assessment Date**: 2026-03-14  
**Scope**: Next.js proxy + Go backend API, auth, payments, content streaming, admin  
**Framework**: OWASP API Security Top 10, MITRE ATT&CK for Web (adapted), Palantir ADS  
**Author**: Threat Detection Engineer

---

## Executive Summary

The application has **strong preventive controls** (CSRF, rate limits, path guards, auth) but **weak detection coverage**. Security events are logged to `console` only — no structured logging, no SIEM integration, no alerting. An attacker who bypasses or evades preventive controls would likely go **undetected**.

| Metric | Value |
|--------|-------|
| **Preventive controls** | Strong (CSRF, rate limit, auth, BOLA) |
| **Detection coverage** | Low — events logged but not queryable/alertable |
| **Critical gaps** | 5 techniques with zero detection |
| **Recommendation** | Add structured security event logging + detection rules |

### Top 5 Critical Detection Gaps

| Gap | Technique | Risk | Current State |
|-----|-----------|------|---------------|
| 1 | Brute force / credential stuffing | Account takeover | Rate-limited but **not logged** for correlation |
| 2 | Failed auth spike (distributed) | Credential stuffing | No aggregation across IPs or time windows |
| 3 | Admin abuse / privilege escalation | Insider / compromised admin | No admin action audit trail |
| 4 | Payment fraud / promo abuse | Revenue loss | No anomaly detection on purchase patterns |
| 5 | Session hijacking / token theft | Account takeover | No geo/device anomaly on session use |

---

## 1. Detection Coverage by Attack Vector

### 1.1 Authentication & Account Takeover

| Technique | OWASP / ATT&CK | Preventive | Detection | Gap |
|-----------|----------------|------------|-----------|-----|
| Brute force login | API2, T1110 | ✅ 20/5min IP, 10/5min email | ❌ No structured log | **CRITICAL** |
| Credential stuffing | API2 | ✅ Rate limit | ❌ No 401 spike detection | **CRITICAL** |
| Password reset abuse | API6 | ✅ 5/15min IP | ❌ No log | **HIGH** |
| Registration bot | API6 | ✅ Turnstile, 10/15min | ⚠️ k6 test exists | **MEDIUM** |
| Session fixation | API2 | ✅ JWT + Redis | ❌ No detection | **LOW** |
| OAuth token theft | API2 | ✅ Discord flow | ❌ No anomaly | **MEDIUM** |

**Current logging**: `log.Printf` in Go for errors; `console.error`/`console.warn` in Next.js middleware. **None** of these produce structured, queryable security events.

### 1.2 Authorization & Access Control

| Technique | OWASP / ATT&CK | Preventive | Detection | Gap |
|-----------|----------------|------------|-----------|-----|
| BOLA (content access) | API1 | ✅ CheckContentAccess | ❌ No log on 403 | **HIGH** |
| Admin privilege abuse | API5 | ✅ RequireAdmin | ❌ No admin action log | **CRITICAL** |
| Horizontal privilege escalation | API1 | ✅ Session ownership | ❌ No anomaly | **MEDIUM** |

### 1.3 Injection & Input Abuse

| Technique | OWASP / ATT&CK | Preventive | Detection | Gap |
|-----------|----------------|------------|-----------|-----|
| Path traversal | API8 | ✅ isSafeR2FolderPath | ❌ No log on block | **MEDIUM** |
| SQL injection | API8 | ✅ Parameterized queries | N/A (prevented) | — |
| Open redirect | API7 | ⚠️ Custom link dest | ❌ No validation | **MEDIUM** |

### 1.4 Abuse & Fraud

| Technique | OWASP / ATT&CK | Preventive | Detection | Gap |
|-----------|----------------|------------|-----------|-----|
| Promo code abuse | API6 | ⚠️ Per-code limits | ❌ No anomaly | **HIGH** |
| Referral fraud | — | ✅ 200/min per IP | ❌ No spike detection | **MEDIUM** |
| Content scraping | — | ⚠️ Auth required | ❌ No volume anomaly | **MEDIUM** |
| Payment fraud | — | ✅ BLIK limits | ❌ No pattern detection | **HIGH** |

### 1.5 Infrastructure & DoS

| Technique | OWASP / ATT&CK | Preventive | Detection | Gap |
|-----------|----------------|------------|-----------|-----|
| Rate limit bypass | API4 | ✅ 120/min | ⚠️ Logged to console | **MEDIUM** |
| CSRF attempt | API8 | ✅ Origin check | ⚠️ Logged to console | **MEDIUM** |
| DDoS / resource exhaustion | API4 | ✅ Rate limit | ❌ No volumetric alert | **LOW** |

---

## 2. Current Logging Assessment

### What Is Logged (and where)

| Event | Location | Format | Queryable? |
|-------|----------|--------|------------|
| CSRF block | `middleware.ts:54` | `console.error` | ❌ No |
| Rate limit hit | `middleware.ts:71` | `console.warn` | ❌ No |
| Login rate limit | Go `common.RateLimited` | HTTP 429 only | ❌ No |
| Register success | `handler.go:195` | `log.Printf` | ❌ No |
| Turnstile failure | `handler.go:59-69` | `log.Printf` | ❌ No |
| Auth errors | Go handlers | HTTP 401/400 | ❌ No |
| Sentry errors | `logger.error` | Sentry | ⚠️ Partial (client-side) |

**Verdict**: No structured security event stream. Cannot run detection queries. Cannot alert.

---

## 3. Detection Rules to Implement

### 3.1 Structured Security Event Schema

Before any detection, events must be emitted in a consistent format. Recommended schema:

```json
{
  "ts": "2026-03-14T12:00:00.000Z",
  "event": "auth.login.failed",
  "ip": "1.2.3.4",
  "path": "/api/auth/login",
  "email_hash": "sha256:abc...",
  "user_agent": "...",
  "cf_ray": "...",
  "metadata": { "reason": "invalid_password" }
}
```

**Event types to emit**:
- `auth.login.failed` — 401 on login
- `auth.login.rate_limited` — 429 on login
- `auth.register.rate_limited` — 429 on register
- `auth.reset.rate_limited` — 429 on reset-password
- `csrf.blocked` — 403 from middleware
- `ratelimit.hit` — 429 from middleware
- `access.denied` — 403 on content/admin (BOLA attempt)
- `admin.action` — any admin API call (who, what, when)

### 3.2 Detection Rule: Brute Force Login (401 Spike)

**Hypothesis**: An IP or email is under credential stuffing attack — many failed logins in a short window.

**Data source**: `auth.login.failed` events  
**Logic**: Count failures per `ip` or per `email_hash` in 5-minute windows. Alert if >15 failures from same IP or >8 from same email.

**Implementation**: Requires structured logging first. If using Cloudflare Logpush or similar, equivalent query:

```
# Pseudocode for SIEM / Logpush
| where event == "auth.login.failed"
| summarize count() by ip, bin(ts, 5m)
| where count_ > 15
```

### 3.3 Detection Rule: Auth Rate Limit Abuse

**Hypothesis**: Attacker is probing rate limits by hitting login/register repeatedly until 429.

**Data source**: `auth.login.rate_limited`, `auth.register.rate_limited`  
**Logic**: Alert if same IP hits rate limit 3+ times in 1 hour.

**Current gap**: These events are **not logged** — backend returns 429 but does not emit a security event.

### 3.4 Detection Rule: CSRF Attempt

**Hypothesis**: Cross-site request forgery attempt (malicious site trying to trigger state-changing action).

**Data source**: `csrf.blocked`  
**Logic**: Alert on every CSRF block (low volume expected). Correlate with Origin header for threat intel.

**Current gap**: `console.error` only — not structured, not shipped.

### 3.5 Detection Rule: Admin Action Audit

**Hypothesis**: Compromised admin or insider abuse — high-risk actions (user ban, role change, settings change) should be audited.

**Data source**: `admin.action`  
**Logic**: Log every admin API call with `admin_id`, `action`, `resource`, `timestamp`. Alert on: BanUser, UpdateUser (role change), UpdateSettings, DeletePackage, CreatePromoCode.

**Current gap**: **Zero** admin action logging.

### 3.6 Detection Rule: BOLA / Unauthorized Content Access

**Hypothesis**: Attacker probing content IDs to access others' purchases.

**Data source**: `access.denied` (403 on `/api/content/*`, `/api/purchases`, etc.)  
**Logic**: Alert if same IP gets 10+ 403s in 5 minutes (enumeration attempt).

**Current gap**: 403 responses are not logged as security events.

---

## 4. Threat Hunt Playbooks

### Hunt 1: Credential Stuffing Campaign

**Hypothesis**: Credential stuffing in progress — many IPs each with few failures, or few IPs with many failures.

**Steps**:
1. If structured logs exist: `auth.login.failed` grouped by ip, bin(ts, 1h). Look for IPs with >20 failures.
2. If not: Enable structured logging for login failures first.
3. Cross-reference with threat intel (have these IPs appeared in breach dumps?).

**Outcome**: Convert to detection rule (401 spike) and/or blocklist.

### Hunt 2: Admin Account Compromise

**Hypothesis**: Admin session stolen — unusual admin actions from new geo or user-agent.

**Steps**:
1. Implement `admin.action` logging.
2. Baseline: normal admin actions (who does what, from where).
3. Hunt for: admin login from new country, admin action at unusual hour, bulk operations.

**Outcome**: Add geo/device anomaly detection for admin sessions.

### Hunt 3: Referral / Promo Abuse

**Hypothesis**: Self-referral or promo code sharing abuse — same user/IP creating multiple accounts or redeeming same promo repeatedly.

**Steps**:
1. Query: registrations with same ref code, same IP, within 24h.
2. Query: promo redemptions by same IP or same payment method.
3. Correlate with referral payout data.

**Outcome**: Add velocity rules (max N registrations per ref per IP per day).

---

## 5. Implementation Roadmap

### Phase 1: Structured Security Logging (1–2 weeks)

| Priority | Task | Owner | Status |
|----------|------|-------|--------|
| P0 | Add structured `security_event` logger (JSON to stdout or Cloudflare Logpush) | Backend | ✅ Done |
| P0 | Emit `auth.login.failed`, `auth.login.rate_limited`, `csrf.blocked`, `ratelimit.hit` | Backend + Next.js | ✅ Done |
| P1 | Emit `access.denied` on 403 for content/admin | Backend | Pending |
| P1 | Emit `admin.action` for all admin API calls | Backend | Pending |

**Implemented (2026-03-14):**
- `backend/internal/security/events.go` — `Emit()`, `HashEmail()`; enabled when `SECURITY_EVENTS=1` or `ENVIRONMENT=production`
- `src/lib/security-events.ts` — `emitSecurityEvent()`; enabled when `SECURITY_EVENTS=1` or `NODE_ENV=production`
- Auth handler: `auth.login.failed`, `auth.login.rate_limited`, `auth.register.rate_limited`, `auth.forgot.rate_limited`, `auth.reset.rate_limited`
- Middleware: `csrf.blocked`, `ratelimit.hit`

### Phase 2: Detection Rules (2–4 weeks)

| Priority | Rule | Data Source |
|----------|------|-------------|
| P0 | Brute force (401 spike) | auth.login.failed |
| P0 | Auth rate limit abuse | auth.login.rate_limited |
| P1 | CSRF attempt | csrf.blocked |
| P1 | BOLA enumeration | access.denied |
| P2 | Admin action audit | admin.action |

### Phase 3: Alerting & Triage

| Priority | Task |
|----------|------|
| P0 | Connect log stream to Cloudflare Logpush / Datadog / Grafana (or equivalent) |
| P1 | Create dashboards: auth failures, rate limits, admin actions |
| P2 | Define alert thresholds and on-call runbooks |

---

## 6. Detection-as-Code Snippet

Example: Add security event emission to Go auth handler.

```go
// internal/security/events.go
package security

import (
	"encoding/json"
	"log"
	"os"
	"time"
)

type SecurityEvent struct {
	TS       string                 `json:"ts"`
	Event    string                 `json:"event"`
	IP       string                 `json:"ip"`
	Path     string                 `json:"path,omitempty"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

func Emit(event string, ip, path string, meta map[string]interface{}) {
	e := SecurityEvent{
		TS:       time.Now().UTC().Format(time.RFC3339Nano),
		Event:    event,
		IP:       ip,
		Path:     path,
		Metadata: meta,
	}
	b, _ := json.Marshal(e)
	if os.Getenv("SECURITY_EVENTS") == "1" {
		log.Printf("[SECURITY] %s", string(b))
	}
}
```

Usage in `auth/handler.go`:

```go
// After rate limit check fails:
security.Emit("auth.login.rate_limited", ip, "/api/auth/login", map[string]interface{}{
	"email_hash": hashEmail(req.Email), // Don't log plain email
})

// After Login returns error:
security.Emit("auth.login.failed", ip, "/api/auth/login", map[string]interface{}{
	"reason": "invalid_password", // or "user_not_found", "oauth_account"
})
```

---

## 7. Success Metrics

| Metric | Target |
|--------|--------|
| Security events emitted | 100% of auth failures, rate limits, CSRF blocks, admin actions |
| Mean time to detect | <24h for brute force campaign (once logging is live) |
| False positive rate | <10% on brute force rule (tune threshold) |
| Admin action audit | 100% of admin API calls logged |

---

## 8. References

- [OWASP API Security Top 10](https://owasp.org/API-Security/)
- [MITRE ATT&CK — Initial Access, Credential Access](https://attack.mitre.org/)
- [Palantir Alerting and Detection Strategy](https://github.com/palantir/alerting-detection-strategy)
- [Sigma Rules for Web Applications](https://github.com/SigmaHQ/sigma)
- [SECURITY_AUDIT_2026-03.md](./SECURITY_AUDIT_2026-03.md) — Preventive controls
- [API-SECURITY-AUDIT.md](./API-SECURITY-AUDIT.md) — API layer assessment

---

**Report Status**: Complete  
**Next Review**: After Phase 1 (structured logging) is implemented.
