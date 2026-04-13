"use client";

import { useTranslations } from "next-intl";

export function SkipToMainLink() {
  const t = useTranslations("common");

  return (
    <a
      href="#main"
      className="absolute left-4 top-4 z-[100] px-4 py-2 bg-primary text-primary-foreground rounded-xl -translate-y-[200%] focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-ring transition-transform duration-150"
    >
      {t("skipToMain")}
    </a>
  );
}
