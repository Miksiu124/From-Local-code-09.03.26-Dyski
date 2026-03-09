# NGINX Security Audit

**Date:** 2026-03-02  
**Configs:** `nginx/nginx.conf` (dev), `nginx/nginx.conf.production` (prod)

---

## Executive Summary

The NGINX setup has solid baseline security (TLS 1.2/1.3, security headers, default server ghost mode, Cloudflare Origin Pulls). Several hardening improvements were identified and applied to the production config.

---

## What Was Already Good

| Item | Status |
|------|--------|
| `server_tokens off` | ✅ Hides nginx version |
| Default server ghost mode | ✅ `ssl_reject_handshake on` + `return 444` for IP-based requests |
| TLS 1.2/1.3 only | ✅ No legacy protocols |
| Strong cipher suites | ✅ ECDHE, no export ciphers |
| `ssl_session_tickets off` | ✅ Mitigates CVE-2025-23419 (SSL session reuse) |
| Security headers | ✅ CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy |
| `client_max_body_size 50M` | ✅ Bounded upload size |
| `proxy_hide_header X-Powered-By` | ✅ Reduces info leakage |

---

## Vulnerabilities & Gaps Addressed

### 1. **No NGINX-Level Rate Limiting** (Fixed)

**Risk:** DDoS / connection exhaustion before requests reach app. README claimed "Nginx zones" but none were configured.

**Fix:** Added `limit_req_zone` and `limit_conn_zone` with conservative limits (50 req/s, burst 100; 20 conn/IP) suitable for HLS streaming.

### 2. **Real IP Not Extracted from Cloudflare** (Fixed)

**Risk:** Backend saw Cloudflare's IP instead of client IP. Auth rate limiting (login, register, forgot-password) used IP; incorrect IP = weak protection.

**Fix:** Added `set_real_ip_from` (Cloudflare IPv4/IPv6 ranges) and `real_ip_header CF-Connecting-IP` so `X-Real-IP` passed to backend is the actual client IP.

### 3. **Missing Permissions-Policy** (Fixed)

**Risk:** Browsers may allow unnecessary features (camera, geolocation, etc.) by default.

**Fix:** Added `Permissions-Policy: accelerometer=(), camera=(), geolocation=(), ...` to restrict unused features.

### 4. **CVE-2025-23419 (SSL Session Reuse)** – Mitigated

**Affects:** nginx 1.11.4–1.27.3. Bypass of client cert auth via TLS session resumption when multiple server blocks share session cache.

**Status:** `ssl_session_tickets off` already reduces risk. Ensure `nginx:alpine` image is **1.27.4+** (or pin `nginx:1.28-alpine` / `nginx:1.30-alpine`).

### 5. **CVE-2024-7347 (MP4 Module)** – N/A

**Affects:** ngx_http_mp4_module. This config does not use `mp4` or `flv` modules.

### 6. **CVE-2025-53859 (SMTP Module)** – N/A

**Affects:** ngx_mail_smtp_module. This config does not use the mail module.

---

## Items Not Changed (By Design)

| Item | Reason |
|------|--------|
| CSP `unsafe-inline` | Required for Next.js/React; removing would break app |
| `client_max_body_size 50M` | Needed for proof uploads (12M) and uploads |
| No rate limit on HLS segments | 50 req/s covers heavy streaming; higher limits would weaken protection |

---

## Cloudflare IP Ranges

The `set_real_ip_from` directives use Cloudflare IP ranges. **Update periodically** when Cloudflare adds new ranges:

- IPv4: https://www.cloudflare.com/ips-v4

- IPv6: https://www.cloudflare.com/ips-v6

---

## Verification After Deploy

1. **Rate limiting:** `curl -v` repeated many times quickly; expect 503 with `limit_req` or 503 with `limit_conn` when exceeded.
2. **Real IP:** Check backend logs; `X-Real-IP` should show client IP, not Cloudflare IP.
3. **Config:** `docker compose exec nginx nginx -t` to validate config before/after changes.

---

## Docker Image Version

**Recommendation:** Pin `nginx:1.28-alpine` or `nginx:1.30-alpine` in `docker-compose.yml` instead of `nginx:alpine` to avoid surprise CVEs from newer releases. Check `nginx -v` periodically.
