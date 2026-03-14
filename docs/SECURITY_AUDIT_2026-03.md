# Security Audit Report

**Date**: 2026-03-13  
**Scope**: ContentManager / ContentVault — Next.js proxy, Go backend, NGINX, Docker  
**Auditor**: Security Engineer (application security assessment)

---

## Executive Summary

The application has a **solid security baseline** with CSRF protection, rate limiting, path traversal guards, security headers, and proper auth flows. Several findings require remediation, including a **Critical** credential exposure risk, **High** dependency vulnerabilities, and **Medium** logic/configuration issues.

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 1 | Action required |
| High | 4 | Action required |
| Medium | 5 | Recommended |
| Low | 4 | Optional |

---

## 1. Critical Findings

### C1. `.env` File with Real Secrets in Workspace

**Risk**: The file `ContentManager/.env` contains real credentials (JWT_SECRET, R2_SECRET_ACCESS_KEY, STREAMING_TOKEN_SECRET, DISCORD_CLIENT_SECRET, SMTP_PASSWORD, TURNSTILE_SECRET_KEY, POSTGRES_PASSWORD). If this file is ever committed or the workspace is shared, all secrets are compromised.

**Evidence**: Grep located `.env` with live values. `.gitignore` correctly excludes `.env`, but local files can be accidentally committed or exposed.

**Remediation**:
- Confirm `.env` is never committed: `git status` should never show `.env`
- Add a pre-commit hook or CI check that fails if `.env` is staged
- Use a secrets manager (e.g. Doppler, Vault) or env injection in production
- Rotate all secrets if there is any doubt they were exposed

---

## 2. High Findings

### H1. Password Reset Token Not URL-Encoded

**Location**: `backend/internal/auth/handler.go:397`

```go
resetURL := h.cfg.FrontendURL + "/reset-password?token=" + token
```

**Risk**: If the reset token contains `&`, `=`, `+`, or other URL-unsafe characters, the link can break or be misinterpreted. Verify-email correctly uses `url.QueryEscape(token)` (line 186).

**Remediation**:
```go
resetURL := h.cfg.FrontendURL + "/reset-password?token=" + url.QueryEscape(token)
```

---

### H2. NPM High-Severity Vulnerabilities

**Evidence**: `npm audit --audit-level=high` reports 3 high-severity issues:

| Package | Issue |
|---------|-------|
| flatted | Unbounded recursion DoS (GHSA-25h7-pfq9-p65f) |
| serialize-javascript | RCE via RegExp.flags (GHSA-5c6j-r48x-rmvq) |
| fast-xml-parser | Stack overflow in XMLBuilder (GHSA-fj3w-jwp8-x2g3) |

**Remediation**:
```bash
npm audit fix
```
Re-run `npm audit` and address any remaining issues. Ensure CI runs `npm audit --audit-level=high` and fails on high/critical.

---

### H3. Upstash Rate Limiter Ignores Limit Parameter

**Location**: `src/lib/rate-limit.ts`

**Issue**: The Upstash `Ratelimit` instance is created with `DEFAULT_LIMIT` (120). When middleware calls `checkRateLimit(key, 300, 60000)` for OPTIONS, the Upstash limiter still enforces 120. The `limit` parameter is only used by the in-memory fallback.

**Impact**: OPTIONS requests get 120/min instead of 300/min when Upstash is used. This can cause legitimate CORS preflights to be rate-limited under load.

**Remediation**: Either create separate Upstash limiters for different limits, or use a limiter that accepts per-call limits (e.g. Upstash’s `limit` with custom config). Alternatively, use distinct keys for OPTIONS (e.g. `opt:ip`) with a higher limit in a separate limiter.

---

### H4. Admin UpdateSettings Allows Arbitrary `discord_*` Keys

**Location**: `backend/internal/admin/handler.go:947`

```go
if !allowedSettingsKeys[entry.Key] && !strings.HasPrefix(entry.Key, "discord_") {
    continue
}
```

**Risk**: Any key starting with `discord_` bypasses the whitelist. An admin could set `discord_arbitrary_key` with arbitrary JSON. If the admin account is compromised, this expands the attack surface. Low likelihood but weakens defense-in-depth.

**Remediation**: Replace the prefix check with an explicit whitelist, e.g.:
```go
var discordAllowedKeys = map[string]bool{"discord_webhook_url": true, "discord_ping_role_id": true}
if !allowedSettingsKeys[entry.Key] && !discordAllowedKeys[entry.Key] {
    continue
}
```

---

## 3. Medium Findings

### M1. Slug Parameter Not Sanitized in ModelAvatar / ModelHeader

**Location**: `backend/internal/content/handler.go` — `ModelAvatar`, `ModelHeader`

**Issue**: `slug` from `c.Param("slug")` is used directly in R2 paths and DB queries. DB uses parameterized queries (safe). R2 keys like `avatars/{slug}_avatar.webp` could, in theory, be abused with path-like values (e.g. `../`). R2/S3 typically treat keys as opaque strings, but sanitization is recommended.

**Remediation**: Validate `slug` against `[A-Za-z0-9._-]+` (or your allowed charset) before use.

---

### M2. Custom Link Open Redirect

**Location**: `backend/internal/links/handler.go`, `src/app/l/[slug]/route.ts`

**Issue**: Custom link `destination` comes from the DB (admin-controlled). If an admin sets `destination` to `https://evil.com`, users are redirected there. This is an open redirect; impact depends on trust in admins.

**Remediation**: Validate `destination` to allow only same-origin or an allowlist of domains. For external links, consider a warning page or `rel="noopener noreferrer"` if opening in a new tab.

---

### M3. ResetPassword Missing Rate Limit

**Location**: `backend/internal/auth/handler.go` — `ResetPassword`

**Issue**: Login, Register, and ForgotPassword are rate-limited. ResetPassword is not. An attacker with a valid token can try many passwords; tokens are single-use, but rate limiting reduces brute-force attempts during the token’s validity window.

**Remediation**: Add per-token or per-IP rate limiting for ResetPassword (e.g. 5 attempts per token or per IP per 15 minutes).

---

### M4. DeletePackage / DeletePromoCode Missing UUID Validation

**Location**: `backend/internal/admin/handler.go` — `DeletePackage`, `DeletePromoCode`

**Issue**: These handlers use `c.Param("id")` without `common.IsValidUUID()`. Other admin handlers (e.g. ApprovePurchase, GetUser) validate UUIDs. Inconsistent validation can lead to odd behavior or errors.

**Remediation**: Add `if !common.IsValidUUID(id) { return common.BadRequest(c, "Invalid ID format") }` before DB operations.

---

### M5. StreamPendingPurchases Admin-Only Check

**Location**: `backend/cmd/server/main.go`

**Status**: `StreamPendingPurchases` is correctly placed under `adminGroup` with `authMW.Authenticate` and `adminMW.RequireAdmin`. No change needed; documented for completeness.

---

## 4. Low Findings

### L1. X-Forwarded-For Trust

**Location**: `src/middleware.ts:11-14`

**Issue**: When `cf-connecting-ip` is absent, the first IP in `x-forwarded-for` is used. If the app is not behind a trusted proxy, this can be spoofed. NGINX and Cloudflare are typically trusted; ensure the chain is correct.

**Remediation**: Document that the app must run behind Cloudflare or a trusted proxy that sets `cf-connecting-ip` or `x-real-ip`. NGINX config already uses `real_ip_header CF-Connecting-IP`.

---

### L2. JWT Logging in Development

**Location**: `backend/internal/middleware/auth.go:150-152`

**Issue**: JWT parse errors are logged in non-production. Ensure logs are not exposed or shipped to third parties in production.

**Remediation**: Confirm production logging excludes sensitive data and that log aggregation access is restricted.

---

### L3. Session Cookie Without __Host- Prefix

**Location**: `backend/internal/auth/handler.go` — session cookie

**Issue**: The session cookie does not use the `__Host-` prefix. `__Host-` enforces Secure and Path=/, reducing some cookie-related risks.

**Remediation**: Consider `cookie.Name = "__Host-session_token"` when `cfg.IsProduction()` (requires HTTPS). Test compatibility with your auth flow.

---

### L4. Rate Limit Key: IP-Only for Auth Paths

**Location**: `src/middleware.ts:63`

**Issue**: The API-SECURITY-AUDIT recommended using IP-only keys for auth paths to avoid path-based bypass. Current key is `IP:path`, so `/api/auth/login` and `/api/auth/register` are limited per path. An attacker could still hit multiple auth paths.

**Remediation**: For `/api/auth/*`, use an IP-only key (e.g. `auth:${ip}`) with a stricter limit. The Go backend already has its own rate limits for login/register.

---

## 5. Controls Verified as Adequate

| Control | Status |
|---------|--------|
| CSRF (Origin/Referer) | ✅ Non-GET requests validated |
| Path traversal (R2, filenames) | ✅ `isSafeR2FolderPath`, `sanitizeFilename` |
| BOLA (content access) | ✅ `CheckContentAccess`, `CheckModelAccess` before streaming |
| Admin authorization | ✅ `RequireAdmin` on all admin routes |
| JWT + Redis session | ✅ Session checked in Redis, banned users rejected |
| Settings whitelist | ✅ `allowedSettingsKeys` (with H4 caveat) |
| SQL injection | ✅ Parameterized queries throughout |
| Streaming token | ✅ HMAC-SHA256, bound to user/content/segment |
| Security headers | ✅ CSP, HSTS, X-Frame-Options, etc. |
| CORS | ✅ Restricted to FrontendURL + localhost in dev |
| Go auth rate limits | ✅ Login 20/5min, Register 5/15min, ForgotPassword 5/15min |
| Turnstile on register | ✅ Enforced when configured |
| .gitignore for .env | ✅ `.env` excluded |

---

## 6. Recommendations Summary

### Immediate (Critical / High)

1. Rotate secrets if `.env` may have been exposed; add CI/pre-commit checks to prevent committing `.env`.
2. URL-encode the password reset token in `ForgotPassword`.
3. Run `npm audit fix` and resolve remaining high/critical issues.
4. Fix Upstash rate limiter to respect the OPTIONS limit (300) or use a separate limiter.

### Short-Term (Medium)

5. Sanitize `slug` in ModelAvatar/ModelHeader.
6. Add rate limiting to ResetPassword.
7. Restrict UpdateSettings `discord_*` keys to an explicit whitelist.
8. Add UUID validation to DeletePackage and DeletePromoCode.
9. Validate custom link destinations (same-origin or allowlist).

### Ongoing

10. Keep an API inventory (endpoints, auth, rate limits).
11. Re-run `npm audit` in CI.
12. Periodically review Cloudflare IP ranges for `set_real_ip_from`.
13. Pin NGINX image version (e.g. `nginx:1.28-alpine`) per NGINX_SECURITY_AUDIT.

---

## 7. Test Coverage (Existing)

| Test | Location | Status |
|------|----------|--------|
| Path guard | `path-guard.test.ts` | ✅ |
| Rate limit logic | `rate-limit.test.ts` | ✅ |
| Middleware (CSRF, rate limit) | `middleware.test.ts` | ✅ |
| Bot registration (Turnstile) | `bot-registration-attack-k6.js` | ✅ |
| Stream load test | `load-test-streams-k6.js` | ✅ |

---

**Report Status**: Complete  
**Remediations Applied**: 2026-03-13 — H1, H2, H3, H4, M1, M2, M3, M4, C1 implemented.  
**Next Review**: Recommended in 6–12 months or after major changes.
