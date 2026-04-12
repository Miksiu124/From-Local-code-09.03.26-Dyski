/**
 * First-party funnel events → POST /api/growth-hacker (Next rewrites to Go backend).
 * Event names: lowercase [a-z0-9_], must start with a letter. No PII in props.
 */

import { GROWTH } from "@/lib/growth-event-names";

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
    // sendBeacon survives page unload / tab close better than fetch keepalive (e.g. video_engagement).
    const blob = new Blob([body], { type: "application/json" });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon("/api/growth-hacker", blob)) {
        return;
      }
    }
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
const TAB_SESSION_KEY = "gf_tab_session_id";

/** Stable id per browser tab (sessionStorage) for growth correlation; safe to send server-side. */
export function getGrowthTabSessionId(): string {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return "";
  try {
    let id = sessionStorage.getItem(TAB_SESSION_KEY);
    if (id && id.length >= 8) return id;
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `t_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    sessionStorage.setItem(TAB_SESSION_KEY, id);
    return id;
  } catch {
    return "";
  }
}

/** One session_start per tab session (sessionStorage). */
export function emitSessionStart(extra: GrowthProps = {}): void {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return;
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return;
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // storage blocked
  }
  emitGrowthEvent(GROWTH.SESSION_START, {
    source: sessionReferrerHost(),
    path: typeof window !== "undefined" ? window.location.pathname : "",
    ...extra,
  });
}
