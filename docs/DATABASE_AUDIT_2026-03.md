# Database Structure Audit — March 2026

**Scope:** PostgreSQL schema used by ContentManager (Prisma + Go backend).  
**Rule:** No removals — audit only. Recommendations are additive.

---

## 1. Schema Overview

### 1.1 Tables (28 total)

| Table | Purpose |
|-------|---------|
| `users` | User accounts, auth, credits, referral codes |
| `accounts` | NextAuth OAuth provider accounts |
| `sessions` | Session tokens (audit; active session in Redis) |
| `verification_tokens` | Email verification |
| `countries` | Country lookup (ISO 3166-1 alpha-2) |
| `models` | Content models (creators) |
| `content_items` | Videos/photos per model |
| `credit_packages` | Credit purchase tiers |
| `credit_purchases` | Credit purchase orders |
| `purchases` | Credit spend (model/bundle access) |
| `credit_transactions` | Credit ledger (purchase/spend/refund/adjustment) |
| `user_access` | Access grants (per purchase or admin) |
| `notifications` | User notifications |
| `favorites` | User favorites (user ↔ content_item) |
| `settings` | Key-value config |
| `promo_codes` | Promo codes |
| `referrals` | Referrer ↔ referee relationships |
| `referral_link_visits` | Referral link click tracking |
| `referral_link_variants` | A/B variant definitions |
| `custom_links` | Short links / redirects |
| `link_visits` | Custom link click tracking |

### 1.2 Enums

- `user_role`, `purchase_type`, `credit_purchase_status`, `payment_method`, `crypto_currency`
- `credit_transaction_type`, `notification_type`, `content_type`, `access_duration`
- `promo_discount_type`

---

## 2. Prisma vs Migration Drift

### 2.1 Missing in Prisma (DB has, Prisma does not)

| Column | Table | Migration | Usage |
|--------|-------|-----------|--------|
| `country` | `users` | `20260226130000` | Go backend: `credits/handler.go`, `admin/handler.go` — user locale/country |

**Impact:** Prisma cannot read/write `country`. Go uses raw SQL. No Prisma-based flows depend on it.

### 2.2 Nullability Mismatch

| Column | Table | DB | Prisma |
|--------|-------|----|--------|
| `purchase_id` | `user_access` | **Nullable** (admin grants) | **Required** (`String`) |

**Context:** Admin grants create rows with `purchase_id = NULL` (see `admin/handler.go` line 854). Prisma models `purchaseId` as required.

**Impact:** Prisma queries may not handle admin-granted access correctly if they assume `purchaseId` is always set. Go backend uses raw SQL and works as intended.

### 2.3 Enum Drift

| Enum | DB (migrations) | Prisma |
|------|----------------|--------|
| `crypto_currency` | `BTC`, `ETH`, `LTC`, `USDC` (USDT → LTC) | `BTC`, `ETH`, `LTC`, `USDC` ✓ |
| `credit_transaction_type` | Includes `ADJUSTMENT` | Includes `ADJUSTMENT` ✓ |
| `access_duration` | `SEVEN_DAYS`, `FOURTEEN_DAYS`, `THIRTY_DAYS` | Same ✓ |

Enums are aligned.

---

## 3. Index Analysis

### 3.1 Foreign Key Indexes

All FKs used in joins have indexes:

- `users`: `email`, `discord_id`, `referral_code`, `custom_link_id`
- `credit_purchases`: `user_id`, `credit_package_id`, `transaction_code`, `custom_link_id`, `promo_code_id`
- `purchases`: `user_id`, `model_id`
- `user_access`: `user_id`, `model_id`, `purchase_id`, `expires_at`
- `content_items`: `model_id`, `unique_id`
- `referral_link_visits`: `referrer_id`
- `link_visits`: `custom_link_id`

### 3.2 Redundant Indexes (informational only — no removal)

- `users`: `@@index([email])` — `email` is already `@unique` (unique implies index)
- `users`: `@@index([discordId])` — same for `discordId`
- `users`: `@@index([referralCode])` — same for `referralCode`
- `settings`: `@@index([key])` — `key` is already `@unique`

These are redundant but harmless.

### 3.3 Composite Indexes

- `credit_purchases(user_id, status)` — user purchase history
- `purchases(user_id, created_at)` — user purchase timeline
- `user_access(user_id, expires_at)` — active access checks
- `referral_link_visits(referrer_id, created_at)` — time-series
- `referral_link_visits(referrer_id, variant_key)` — A/B analytics
- `link_visits(custom_link_id, created_at)` — link analytics

### 3.4 Partial Index Opportunities (additive)

| Table | Suggested Index | Use Case |
|-------|-----------------|----------|
| `credit_purchases` | `WHERE status = 'PENDING'` | Expiration/cleanup jobs |
| `sessions` | `WHERE expires > now()` | Active session lookup |
| `user_access` | `WHERE expires_at IS NULL OR expires_at > now()` | Active access checks |
| `notifications` | `WHERE is_read = false` | Unread notifications |

---

## 4. Security

### 4.1 Row-Level Security (RLS)

RLS enabled on:

- `accounts`, `sessions`, `credit_purchases`, `purchases`, `credit_transactions`
- `user_access`, `notifications`, `favorites`

Policies use `app.current_user_id`; when unset, all rows are visible (backward compatible).

### 4.2 Tables Without RLS

- `users`, `countries`, `models`, `content_items`, `credit_packages`, `settings`
- `promo_codes`, `referrals`, `referral_link_visits`, `referral_link_variants`
- `custom_links`, `link_visits`, `verification_tokens`

These are either shared/config or handled by app-level auth.

### 4.3 Sensitive Columns

- `users.password` — nullable for OAuth-only users ✓
- `accounts`: `refresh_token`, `access_token`, `id_token` — stored as `TEXT` ✓
- `credit_purchases.payment_proof_url` — payment proof storage

---

## 5. Constraints & Data Integrity

### 5.1 Unique Constraints

- `users`: `email`, `discord_id`, `referral_code`
- `referrals`: `referee_id` (one referrer per referee)
- `referral_link_variants`: `(referrer_id, variant_key)`
- `accounts`: `(provider, provider_account_id)`
- `favorites`: `(user_id, content_item_id)`
- `user_access`: `(user_id, model_id, COALESCE(purchase_id, ''))` — allows multiple admin grants (NULL `purchase_id`)

### 5.2 Referential Integrity

- Cascades: `user_access` → `purchase`, `content_items` → `model`, etc.
- `ON DELETE SET NULL`: `credit_purchases.admin_id`, `purchases.model_id`, `user_access.model_id` (bundle)
- `ON DELETE RESTRICT`: `credit_purchases.credit_package_id`

---

## 6. Triggers

- `update_updated_at()` — applied to tables with `updated_at`
- Tables: `users`, `countries`, `models`, `content_items`, `credit_packages`, `credit_purchases`, `purchases`, `settings`

**Missing trigger:** `custom_links` and `promo_codes` have `updated_at` but no trigger in migrations. Prisma `@updatedAt` is client-side; Go may rely on explicit `updated_at` updates.

---

## 7. Dual Stack (Prisma + Go)

- **Prisma:** Next.js app, seed, some API flows
- **Go:** Auth, credits, purchases, admin, referrals, links, models

Both use the same PostgreSQL DB. Prisma schema is the main source of truth for the frontend; Go uses raw SQL and may diverge (e.g. `country`, nullable `purchase_id`).

---

## 8. Recommendations (Additive Only)

### 8.1 Sync Prisma to DB (no DB changes)

1. Add `country String? @map("country")` to `User` in `schema.prisma`
2. Change `UserAccess.purchaseId` to `purchaseId String?` (nullable) to match admin grants

### 8.2 Optional Index Additions

```sql
-- Pending purchase cleanup
CREATE INDEX CONCURRENTLY idx_credit_purchases_pending_expiration 
ON credit_purchases(expiration_time) WHERE status = 'PENDING';

-- Active access lookup
CREATE INDEX CONCURRENTLY idx_user_access_active 
ON user_access(user_id, model_id) 
WHERE expires_at IS NULL OR expires_at > now();

-- Unread notifications
CREATE INDEX CONCURRENTLY idx_notifications_unread 
ON notifications(user_id) WHERE is_read = false;
```

### 8.3 Optional Triggers

Add `update_updated_at` to `custom_links` and `promo_codes` if the Go backend expects DB-maintained `updated_at`.

### 8.4 Documentation

- Document which tables/columns are Prisma vs Go-owned
- Add migration checklist for schema changes (Prisma + SQL migrations)

---

## 9. Migration History Summary

| Migration | Changes |
|-----------|---------|
| `001_initial_schema` | Core schema, enums, triggers |
| `002_fix_updated_at_defaults` | `updated_at` defaults |
| `20260219*` | Ban, adjustment, featured, fourteen days, nullable `purchase_id`, favorites id |
| `20260225` | `content_items.is_hidden` |
| `20260226*` | Payment addresses, user country, discord, autoplay |
| `20260227` | RLS policies |
| `20260302*` | Email verified, promo codes, referrals, USDT→LTC, PLN |
| `20260305*` | Custom links, link conversions |
| `20260313` | Referral link tracking (visits, variants) |

---

## 10. Summary

- **Structure:** 28 tables, clear separation of concerns, good FK usage
- **Indexes:** FKs indexed; some redundant unique indexes; optional partial indexes for hot paths
- **Security:** RLS on user-scoped tables; policies in place
- **Drift:** `users.country` and `user_access.purchase_id` nullability differ between DB and Prisma
- **Triggers:** `updated_at` on most tables; `custom_links` and `promo_codes` may need triggers if Go expects DB-maintained `updated_at`

No removals recommended. All suggestions are additive (Prisma sync, optional indexes, optional triggers).

---

## Implementation (2026-03-13)

**Completed:**
- Prisma schema: Added `country` to `User`, made `purchaseId` optional on `UserAccess`
- Migration `20260313140000_audit_optimizations`: Partial indexes + `updated_at` triggers for `custom_links` and `promo_codes`

**Data safety:** All changes are additive. No columns, tables, or data removed.
