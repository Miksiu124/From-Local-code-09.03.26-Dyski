# Evidence: Video Player F5 Fix (March 2026)

**Date:** 2026-03-17  
**PM Request:** Fix video player breaking after F5 refresh; keep signed URLs; fallback: redirect to model_folder.

---

## Changes Implemented

### 1. F5 Redirect Fallback (Primary Fix)

**Files:** `model-detail.tsx`, `content-viewer.tsx`

When the user refreshes (F5) while in the video player, they are redirected to the model folder. This prevents the stuck overlay / broken player state that occurs with signed URLs after refresh.

- **Model overlay** (`/models/[slug]?view=id`): Detects `performance.getEntriesByType('navigation')[0].type === 'reload'` and redirects to `/models/[slug]` (preserving filter/sort).
- **Content page** (`/content/[slug]/[contentItemId]`): Same detection, redirects to `/models/[slug]`.

### 2. Video Player Robustness

**File:** `video-player.tsx`

- **autoplayEnabledRef**: Removed `autoplayEnabled` from HLS init effect deps. Using a ref prevents HLS destroy/recreate when preferences load asynchronously (which could break the player).
- **25s loading timeout**: If `canplay` never fires, user sees retry UI after 25s instead of infinite spinner.
- **requestAnimationFrame defer**: Wrapped `initHls()` in `requestAnimationFrame` to avoid connection pool contention on F5.
- **Timeout cleanup**: Loading timeout is cleared on MANIFEST_PARSED, canplay, HLS error, and effect cleanup.

---

## Signed URLs

No changes to signed URLs. R2 presigned segment URLs remain in use. The redirect is a UX fallback when the player fails to recover after refresh.

---

## Test Procedure

1. Navigate to a video (overlay or content page).
2. Press F5.
3. **Expected:** User is redirected to model folder (gallery view).
4. Navigate to video again (no F5) — video should play normally.
5. Direct link to `/models/x?view=id` (no reload) — video should open in overlay.
