# Referral Logic Implementation Plan

> **Product Manager spec** → Backend Architect plan → Implementation  
> **Date:** 2026-03-14

## Current State (Audit)

| Component | Status | Notes |
|-----------|--------|-------|
| **Stage 1: Capture** | ⚠️ Partial | `?ref=` from URL only; **no cookie persistence** – lost if user closes tab |
| **Stage 2: Registration** | ✅ Works | Ref from body/URL; `SaveReferralFromCode` creates referral; self-referral blocked |
| **Stage 3: Code gen** | ⚠️ Partial | 12-char hex (0-9,A-F); has retry on collision; **contains confusing chars** |
| **Stage 4: Conversion** | ✅ Works | `awardReferralCredits` on purchase approval; `credits_awarded_at IS NULL` = PENDING |
| **Anti-gaming** | ❌ Missing | No IP/fingerprint check |
| **Last Click Wins** | N/A | No cookie yet |
| **Idempotency** | ✅ Implicit | `credits_awarded_at IS NULL` ensures single award |

## Implementation Plan

### 1. Stage 1: Client-side capture + cookie (Next.js)

**Files:** `src/middleware.ts` or `src/components/providers/referral-cookie-provider.tsx`, `src/app/(auth)/register/page.tsx`

- **Extraction:** Middleware or root layout checks `?ref=XYZ` on every request.
- **Cookie:** `ref_code` (HttpOnly: false, SameSite: Lax, maxAge: 60 days).
- **Last Click Wins:** New `?ref=` overwrites cookie.
- **Register:** Read ref from cookie as fallback when URL has no `ref`; send in body.

**Why middleware:** Runs on every navigation; can set cookie before page renders.

### 2. Stage 2: Registration (Go)

**Files:** `backend/internal/auth/handler.go`, `backend/internal/auth/service.go`, `backend/internal/referral/handler.go`

- **Transfer:** Frontend sends `ref` from cookie (or URL) in body – already supported.
- **Validation:** Code exists, not self-referral – already done.
- **Anti-gaming (Phase 1):** Compare referee IP to referrer's last known IP. Store referrer IP in Redis on login: `session:ip:{userID}`. On register, if referee IP == referrer IP → reject.
- **Referral record:** No schema change; `credits_awarded_at IS NULL` = PENDING.

### 3. Stage 3: Unique code generation (Go)

**Files:** `backend/internal/referral/handler.go`

- **Charset:** `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no 0,O,1,I,l).
- **Length:** 8 chars.
- **Retry:** On UNIQUE violation, regenerate (max 5 attempts) – already present.

### 4. Stage 4: Conversion (Go)

**Files:** `backend/internal/admin/handler.go`

- **Trigger:** Purchase approval – already in place.
- **Idempotency:** Add `SELECT ... FOR UPDATE` or ensure single UPDATE; current logic is safe (one tx, one award per referee).
- **Notification:** Optional – `publishNotification` to referrer when credits awarded.

### 5. Logic guards

| Guard | Implementation |
|-------|----------------|
| **Anti-gaming** | Store referrer IP in Redis on login; on register with ref, reject if referee IP == referrer IP |
| **Last Click Wins** | Cookie overwrite on new `?ref=` |
| **Idempotency** | `credits_awarded_at` check; consider `referral_reward_id` in credit_transaction for audit |

### 6. Backward compatibility

- `/r/[code]` → redirect to `/register?ref=CODE` – **unchanged**.
- `/register?ref=CODE` – **unchanged**; cookie adds persistence.
- Legacy links – **unchanged**.
- Custom links (`/l/slug`) – **unchanged** (separate flow).

### 7. UI polish

- Referral panel: minor visual tweaks if needed.
- Register page: subtle "Referred by a friend" badge when ref is present.

## Migration / schema

- **No DB migration** for core flow.
- Optional: add `referrer_ip` to Redis session for anti-gaming.

## Testing checklist

- [ ] Referral link `/r/CODE` redirects to home `/?ref=CODE` (not /register)
- [ ] Cookie set when visiting `/?ref=XYZ` (or any page with ?ref=)
- [ ] Cookie persists across sessions (60 days)
- [ ] Last click overwrites cookie
- [ ] Register with ref from cookie (no URL ref) works
- [ ] Self-referral blocked
- [ ] Anti-gaming: same IP blocked
- [ ] New user gets unique referral code on first /referral visit
- [ ] Purchase → referrer gets credits; idempotent on double webhook

## Performance verification

1. **Referral cookie**: `src/lib/referral-cookie.test.ts` — unit tests pass
2. **Load**: Cookie read/write is O(1); no N+1 in referral flow
3. **Redis**: `session:ip:{userID}` — single key lookup on register when ref present
4. **DB**: Existing indexes on `referrals.referrer_id`, `referrals.referee_id`; no new queries
