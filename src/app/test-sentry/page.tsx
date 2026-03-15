"use client";

import * as Sentry from "@sentry/nextjs";

export default function TestSentryPage() {
  const trigger = () => {
    Sentry.captureMessage("Sentry VPS test - client");
    throw new Error("Sentry VPS test - if you see this from dyskiof.net, it works!");
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <button
        type="button"
        onClick={trigger}
        className="rounded-lg bg-primary px-4 py-2 text-primary-foreground"
      >
        Trigger Sentry Test (VPS)
      </button>
    </div>
  );
}
