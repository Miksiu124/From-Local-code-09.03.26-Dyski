/**
 * R2 Auto-Sync — Stub
 *
 * The actual R2 sync logic has been moved to the Go backend.
 * This stub exists so the Next.js instrumentation hook can still import it.
 */
export function startAutoSync() {
    // No-op: sync is handled by the Go backend
    if (process.env.NODE_ENV === "development") {
        console.log("[r2-auto-sync] Skipped — sync is handled by Go backend");
    }
}
