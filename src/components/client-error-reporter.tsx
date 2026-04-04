"use client";

import { useEffect } from "react";
import { buildClientErrorReport } from "@/lib/client-error-report";

/**
 * Reports window.onerror and unhandledrejection to the API (admin observability).
 */
export function ClientErrorReporter() {
  useEffect(() => {
    const send = (message: string, stack?: string, component?: string) => {
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
