/**
 * First-party funnel events → POST /api/growth-hacker (Next rewrites to Go backend).
 * Event names: lowercase [a-z0-9_], must start with a letter. No PII in props.
 */

export type GrowthProps = Record<string, unknown>;

function sessionReferrerHost(): string {
  if (typeof document === "undefined") return "unknown";
  const r = document.referrer;
  if (!r) return "direct";
  try {
    const h = new URL(r).hostname.replace(/^www\./i, "");
    return h || "direct";
  } catch {
    return "direct";
  }
}

/** Fire-and-forget POST; safe to call from client components. */
export function emitGrowthEvent(event: string, props: GrowthProps = {}): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({ event, props });
  try {
    void fetch("/api/growth-hacker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}

const SESSION_KEY = "gf_session_started";

/** One session_start per tab session (sessionStorage). */
export function emitSessionStart(extra: GrowthProps = {}): void {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return;
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return;
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // storage blocked
  }
  emitGrowthEvent("session_start", {
    source: sessionReferrerHost(),
    path: typeof window !== "undefined" ? window.location.pathname : "",
    ...extra,
  });
}
