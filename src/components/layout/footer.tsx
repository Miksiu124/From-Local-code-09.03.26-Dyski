import { useTranslations } from "next-intl";

export function Footer() {
  const t = useTranslations("common");
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-white/[0.04] bg-background">
      <div className="mx-auto w-full min-w-0 max-w-7xl px-4 py-5 text-center text-xs text-muted-foreground">
        <p>&copy; {year} {t("appName")}. All rights reserved.</p>
      </div>
    </footer>
  );
}
