"use client";

import { useState, useEffect, useTransition } from "react";
import { Globe } from "lucide-react";

export function LanguageSwitcher() {
  const [isPending, startTransition] = useTransition();
  const [locale, setLocaleState] = useState("en");

  // Read actual locale from cookie on client mount only (avoids hydration mismatch)
  useEffect(() => {
    const cookieLocale = document.cookie
      .split("; ")
      .find((row) => row.startsWith("locale="))
      ?.split("=")[1];
    if (cookieLocale && ["en", "pl"].includes(cookieLocale)) {
      setLocaleState(cookieLocale);
    }
  }, []);

  const switchLocale = () => {
    const next = locale === "en" ? "pl" : "en";
    startTransition(() => {
      document.cookie = `locale=${next};path=/;max-age=31536000`;
      window.location.reload();
    });
  };

  return (
    <button
      type="button"
      onClick={switchLocale}
      disabled={isPending}
      className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50 touch-manipulation sm:min-h-0 sm:min-w-0 sm:justify-start sm:py-1.5"
      title={locale === "en" ? "Switch to Polish" : "Przełącz na angielski"}
      aria-label={locale === "en" ? "Switch to Polish" : "Przełącz na angielski"}
    >
      <Globe className="h-4 w-4" />
      <span className="uppercase text-xs font-medium">{locale}</span>
    </button>
  );
}
