"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

const CONSENT_KEY = "cookie_consent";

const CONSENT_EVENT = "cookie-consent-update";

function getSnapshot() {
  return typeof window !== "undefined" ? !localStorage.getItem(CONSENT_KEY) : false;
}

function subscribe(onStoreChange: () => void) {
  const handler = () => onStoreChange();
  window.addEventListener(CONSENT_EVENT, handler);
  return () => window.removeEventListener(CONSENT_EVENT, handler);
}

export function CookieBanner() {
  const t = useTranslations("cookieBanner");
  const visible = useSyncExternalStore(subscribe, getSnapshot, () => false);

  const accept = () => {
    localStorage.setItem(CONSENT_KEY, "accepted");
    window.dispatchEvent(new Event(CONSENT_EVENT));
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80"
      role="dialog"
      aria-label={t("title")}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {t("message")}{" "}
          <a href="/privacy" className="underline hover:text-foreground">
            {t("learnMore")}
          </a>
        </p>
        <Button size="sm" onClick={accept}>
          {t("accept")}
        </Button>
      </div>
    </div>
  );
}
