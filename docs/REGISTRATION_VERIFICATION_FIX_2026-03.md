# Registration Verification Fix — March 2026

## Summary

Fixed the "Verification expired. Please complete the challenge again and submit." error during registration that resulted in 400 Bad Request on `POST /api/auth/register`.

## Root Cause

Cloudflare Turnstile tokens expire after **5 minutes** and are **single-use**. When the backend called Cloudflare's siteverify API, failures (expired token, duplicate use, etc.) returned generic messages. The frontend mapped these to "Verification expired" but the UX was poor—users had to manually refresh the page to get a new challenge.

## Changes Made

### Backend (`internal/auth/handler.go`)

1. **Parse Cloudflare error-codes** — The siteverify API returns `error-codes` when validation fails. We now parse these and return user-friendly messages:
   - `timeout-or-duplicate` → "Verification expired. Please complete the challenge again and submit."
   - `missing-input-response` / `invalid-input-response` → Same message
   - `missing-input-secret` / `invalid-input-secret` → "Verification failed. Please try again or contact support."
   - Other failures → "Verification expired. Please complete the challenge again and submit."

2. **Consistent messaging** — All Turnstile-related errors now return the same user-facing message so the frontend can handle them uniformly.

### Frontend (`src/app/(auth)/register/page.tsx`)

1. **Auto-refresh on verification error** — When the API returns a verification-related error, the Turnstile widget is reset so the user gets a fresh challenge without refreshing the page.

2. **`refreshExpired: "auto"`** — Explicitly enabled automatic refresh when the token expires (Cloudflare default, but now explicit).

3. **Turnstile ref** — Added ref to the Turnstile component to call `reset()` when verification fails, giving the user an immediate new challenge.

## Tester Verification Checklist

Please verify the following on **https://dyskiof.net/register**:

### Happy Path

- [ ] Complete the Turnstile challenge (green checkmark appears)
- [ ] Fill in name, email, password, confirm password
- [ ] Submit within 5 minutes of completing the challenge
- [ ] Registration succeeds and redirects to login

### Expired Token Recovery

- [ ] Complete the Turnstile challenge
- [ ] Wait **more than 5 minutes** (or trigger expiration another way)
- [ ] Submit the form
- [ ] Error message: "Verification expired. Please complete the challenge again and submit."
- [ ] Turnstile widget **automatically resets** and shows a new challenge (no page refresh needed)
- [ ] Complete the new challenge and submit again
- [ ] Registration succeeds

### Referral Flow

- [ ] Visit `/register?ref=C2FB06708463` (or any valid referral code)
- [ ] Complete registration
- [ ] Verify referral is attributed (check admin/referral or DB if applicable)

### Edge Cases

- [ ] Submit without completing Turnstile → Button should be disabled (cannot submit)
- [ ] Double-submit (click twice quickly) → First succeeds, second may get "Verification expired" (token single-use) → Widget resets, user can retry
- [ ] Invalid email format → Appropriate validation error
- [ ] Password mismatch → "Passwords do not match" (or equivalent)

## Deployment

- Deployed via `.\scripts\deploy-vps.ps1 -Build`
- API and frontend containers rebuilt and restarted
- Live at: https://dyskiof.net

## Notes

- The 401 errors on `/cdn/register/` and `/cdn/register/auth/verify` in the original screenshot may be unrelated (Cloudflare CDN paths or browser extensions). Focus on the main registration flow.
- Ensure `TURNSTILE_SECRET_KEY` is correctly set in production `.env` on the VPS.
