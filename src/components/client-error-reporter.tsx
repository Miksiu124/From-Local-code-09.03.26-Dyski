"use client";

import { useEffect } from "react";
import { buildClientErrorReport } from "@/lib/client-error-report";

const IGNORE_PATTERNS = [
  /script error\.?$/i,
  /__firefox__/i,
  /window\.__firefox__\.reader/i,
  /aborterror/i,
  /the operation was aborted/i,
  /load failed/i,
  /notallowederror/i,
  /permissions check failed/i,
];

function shouldIgnoreClientError(message: string, stack?: string): boolean {
  const msg = message.trim();
  const st = (stack ?? "").trim();
  const combined = `${msg}\n${st}`;

  if (!msg) return true;
  if (IGNORE_PATTERNS.some((p) => p.test(combined))) return true;

  return false;
}

/**
 * Reports window.onerror and unhandledrejection to the API (admin observability).
 */
export function ClientErrorReporter() {
  useEffect(() => {
    // Avoid flooding observability with same error over and over.
    const seenAt = new Map<string, number>();
    const dedupeWindowMs = 90_000;

    const send = (message: string, stack?: string, component?: string) => {
      if (shouldIgnoreClientError(message, stack)) return;

      const key = `${message}\n${stack ?? ""}`.slice(0, 3000);
      const now = Date.now();
      const prev = seenAt.get(key);
      if (prev && now - prev < dedupeWindowMs) return;
      seenAt.set(key, now);

      void fetch("/api/public/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildClientErrorReport({ message, stack, component })),
      }).catch(() => {});
    };

    const onError = (e: ErrorEvent) => {
      const err = e.error;
      const stack = err instanceof Error ? err.stack : undefined;
      send(e.message || "window.error", stack);
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const msg = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : "";
      send(`unhandledrejection: ${msg}`, stack);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
