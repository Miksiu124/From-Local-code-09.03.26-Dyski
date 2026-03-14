# Data Engineering Audit — Dyskiof ContentManager

**Date:** March 14, 2026  
**Scope:** Data infrastructure — PostgreSQL, Cloudflare R2, sync pipeline, data contracts  
**Lens:** Data Engineer (reliability, schema discipline, observability, idempotency)

---

## Executive Summary

| Metric | Assessment |
|--------|-------------|
| **Data architecture** | PostgreSQL + R2 object store; dual stack (Prisma + Go) |
| **Pipeline type** | R2 → DB sync (admin-triggered, not scheduled) |
| **Data contracts** | Implicit; no formal schema validation or lineage |
| **Idempotency** | Partial — sync uses `ON CONFLICT` but merge scripts are one-off |
| **Observability** | Minimal — no SLA monitoring, freshness alerts, or data quality checks |
| **Overall grade** | **C+** — functional but lacks production-grade data engineering practices |

### Top 5 Critical Gaps

1. **No data freshness SLA** — Sync is manual; no alert if R2/DB drift
2. **R2–DB path coupling** — `folder_name` and path strings are tightly coupled; merge scripts are brittle
3. **No schema validation** — Import infers structure from filenames; no contract enforcement
4. **Orphan risk** — `content_items` can reference R2 paths that no longer exist after merge
5. **Dual stack drift** — Prisma vs Go schema drift (see DATABASE_AUDIT_2026-03.md)

---

## 1. Data Architecture Overview

### 1.1 Data Flow

```
R2 (Cloudflare)                    PostgreSQL
┌─────────────────────┐           ┌──────────────────────┐
│ {folder}/           │  Sync     │ models              │
│   UNIQUE_ID_source/ │ ────────► │ content_items       │
│   *.jpg, *.png      │  (admin)  │ user_access         │
│ avatars/            │           │ purchases           │
└─────────────────────┘           └──────────────────────┘
         │                                    │
         │  API proxy (Go)                    │
         └────────────────────────────────────┘
                      Next.js frontend
```

### 1.2 Layers (Medallion Analogy)

| Layer | Equivalent | Description |
|-------|------------|-------------|
| **Bronze** | R2 raw objects | Immutable; folder structure = `{folder_name}/` |
| **Silver** | `content_items` | Cleansed, deduplicated; `unique_id` = business key |
| **Gold** | API responses | Aggregated for UI (models + stats, access checks) |

**Gap:** No explicit Bronze→Silver contract. Import logic infers schema from filenames.

---

## 2. Pipeline Reliability

### 2.1 R2 Sync Pipeline (`content/service.go`)

| Criterion | Status | Evidence |
|-----------|--------|----------|
| **Idempotent** | ✅ Partial | `ON CONFLICT (unique_id) DO UPDATE` for content_items; models upsert on `folder_name` |
| **Append-only Bronze** | ✅ | R2 is append-only; no in-place transforms |
| **Schema-on-read** | ⚠️ | Import infers VIDEO vs PHOTO from path patterns; no explicit schema |
| **Metadata capture** | ❌ | No `_ingested_at`, `_source_file`; only `created_at`/`updated_at` |
| **Null handling** | ⚠️ | `thumbnail_path`, `hls_master_path`, `duration` nullable; no explicit rules |

### 2.2 Import Logic Risks

**Video detection:** `folder/UNIQUE_ID_source/master-*.m3u8`
- **Risk:** Different HLS layouts (e.g. `master.m3u8` without resolution) may be missed
- **Recommendation:** Document path contract; add validation that matched objects exist

**Photo detection:** `folder/FILENAME.(jpg|png|webp)` excluding `_source` and `avatar`
- **Risk:** `unique_id` = `folderName-filename`; filename collision across models (e.g. `model1-photo.jpg` vs `model2-photo.jpg`) is avoided by prefix, but same-folder duplicate filenames (e.g. `photo.jpg`, `photo (1).jpg`) could collide
- **Recommendation:** Consider hash-based `unique_id` for photos if collision risk exists

### 2.3 Merge Scripts (`merge-r2-folders.py`, `merge-r2-folders-migrate-db.sql`)

| Criterion | Status | Evidence |
|-----------|--------|----------|
| **Idempotent** | ❌ | One-off; re-run would fail (source folders deleted) |
| **Transactional** | ✅ | DB migration uses `BEGIN`/`COMMIT` |
| **Orphan handling** | ⚠️ | Deletes source model; `user_access`, `purchases` updated; R2 objects copied then source deleted. **Risk:** If R2 delete fails after DB commit, orphaned R2 objects remain |
| **Audit trail** | ❌ | No `source_system` or lineage tracking |

**Recommendation:** Add pre-flight checks (source/dest exist, no conflicting `unique_id`); run R2 delete only after DB migration verified.

---

## 3. Data Contracts & Schema

### 3.1 Implicit Contracts

| Contract | Current | Recommended |
|----------|---------|-------------|
| **Model ↔ R2 folder** | `models.folder_name` = R2 prefix | Document in `R2_FOLDER_MERGE_INSTRUCTIONS.md`; add DB check constraint? |
| **ContentItem paths** | `thumbnail_path`, `hls_master_path` relative to bucket | Add validation: path must start with `{folder_name}/` |
| **unique_id** | Videos: raw ID; Photos: `folderName-filename` | Formalize in schema docs; consider CHECK constraint for format |

### 3.2 Missing Schema Validation

- **No Great Expectations / dbt tests** — Data quality is implicit
- **No NOT NULL enforcement** for critical paths — `thumbnail_path` can be null for VIDEO until thumbnail generated
- **Settings JSON** — `settings.value` is JSONB; no schema validation per key

**Recommendation:** Add a `data_contracts.md` documenting:
- R2 path patterns (video, photo, avatar)
- `unique_id` format per content type
- Expected nullability for each path column

---

## 4. Observability & Ops

### 4.1 Current State

| Capability | Status |
|------------|--------|
| **Pipeline SLA** | None — sync is manual |
| **Data freshness** | `models.last_synced_at` exists but no alerting |
| **Row count monitoring** | None |
| **Schema drift detection** | None |
| **Lineage** | None — cannot trace content_item back to R2 object |
| **Runbook** | `R2_FOLDER_MERGE_INSTRUCTIONS.md` exists for merge ops |

### 4.2 Recommendations

1. **Scheduled sync** — Cron or Cloudflare Worker to run `SyncR2` daily; alert on failure
2. **Freshness SLA** — Alert if `last_synced_at` > 24h for any active model
3. **Orphan detection** — Periodic job: `content_items` with paths that 404 on R2 `HeadObject`
4. **Audit columns** — Add `_source_system`, `_ingested_at` to `content_items` for lineage (additive migration)

---

## 5. Storage & Performance

### 5.1 R2 Client (`content/r2.go`)

| Aspect | Status |
|--------|--------|
| **Connection** | S3-compatible client; no connection pooling (stateless) |
| **Pagination** | `ListObjectsV2Paginator` with `MaxKeys: 1000` — handles large buckets |
| **DeleteObjectsUnderPrefix** | Sequential delete per object — could be slow for large folders |
| **Error handling** | Returns errors; no retry/backoff |

**Recommendation:** For bulk deletes, consider S3 DeleteObjects (batch up to 1000 keys) if AWS SDK supports it for R2.

### 5.2 Database

- **Connection pool:** `pgxpool` with `MaxConns: 20`, `MinConns: 2` — reasonable
- **Indexes:** See `DATABASE_AUDIT_2026-03.md` — partial index `idx_content_items_model_active_hidden` exists for model stats
- **Access cache:** `access.ts` — 60s TTL, LRU 10k; invalidated on grant/revoke — good

---

## 6. Security & Data Integrity

### 6.1 R2 Access

- **Credentials:** Env vars `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — standard
- **Proof bucket:** Separate `R2_PROOF_*` for payment proofs — good separation
- **Path traversal:** Paths from DB used directly; ensure no user-controlled path injection in admin handlers

### 6.2 Referential Integrity

- **Cascade:** `content_items` → `model` ON DELETE CASCADE — correct
- **Orphan purchases:** `purchases.model_id` ON DELETE SET NULL — bundle merge could leave `model_id` null; acceptable
- **user_access:** `(user_id, model_id, purchase_id)` unique; nullable `purchase_id` for admin grants — documented in DB audit

---

## 7. Recommendations by Priority

### Immediate (Ship-Blocking)

| # | Action | Owner | Effort |
|---|--------|-------|--------|
| 1 | **Document data contracts** — Create `DATA_CONTRACTS.md` with R2 path patterns, `unique_id` formats, nullability rules | Data/Backend | S |
| 2 | **Merge script safety** — Add dry-run validation; ensure R2 delete runs only after DB success; document rollback | Backend | M |

### Short-Term (This Sprint)

| # | Action | Owner | Effort |
|---|--------|-------|--------|
| 3 | **Scheduled sync** — Cron or Worker to run SyncR2 daily; log failures | Infra | M |
| 4 | **Freshness alert** — Alert if `last_synced_at` > 24h for any `is_active` model | Infra | S |
| 5 | **Sync Prisma drift** — Apply DATABASE_AUDIT recommendations (country, purchaseId) | Full-stack | S |

### Medium-Term (Next Sprint)

| # | Action | Owner | Effort |
|---|--------|-------|--------|
| 6 | **Orphan detection job** — Periodic check: content_items paths that 404 on R2 | Backend | M |
| 7 | **Audit columns** — Add `_ingested_at`, `_source_file` to content_items (additive) | Backend | S |
| 8 | **Import validation** — Post-import: verify matched R2 objects still exist | Backend | M |

### Long-Term

| # | Action | Owner | Effort |
|---|--------|-------|--------|
| 9 | **Data quality framework** — dbt or custom checks for critical tables | Data | L |
| 10 | **Lineage** — Track content_item → R2 object for debugging | Data | L |

---

## 8. Positive Findings

- **Idempotent upserts** — Content import uses `ON CONFLICT DO UPDATE`; safe to re-run
- **Deduplication** — Post-import cleanup removes duplicate VIDEO entries by `hls_folder_path`
- **Partial index** — `idx_content_items_model_active_hidden` optimizes model list query
- **Access cache** — LRU-bounded, TTL-based; reduces DB load for access checks
- **Merge documentation** — `R2_FOLDER_MERGE_INSTRUCTIONS.md` is thorough
- **Transactional migrations** — DB merge script uses transaction; rollback possible

---

## 9. Summary

The data infrastructure is **functional** but lacks production-grade data engineering practices. The R2 sync pipeline is idempotent at the row level but has no SLA, observability, or formal data contracts. Merge operations are one-off and carry orphan risk if R2 delete fails after DB commit.

**Priority:** Document contracts, add scheduled sync + freshness alert, harden merge scripts. Then consider orphan detection and audit columns.

---

## References

- `DATABASE_AUDIT_2026-03.md` — Schema, indexes, Prisma drift
- `R2_FOLDER_MERGE_INSTRUCTIONS.md` — Merge procedure
- `REMEDIATION_PLAN.md` — Frontend/performance remediation
- `prisma/schema.prisma` — Canonical schema (with known drift)
- `backend/internal/content/service.go` — Sync and import logic
