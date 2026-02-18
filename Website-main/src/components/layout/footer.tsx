import { useTranslations } from "next-intl";

export function Footer() {
  const t = useTranslations("common");
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-background">
      <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
        <p>&copy; {year} {t("appName")}. All rights reserved.</p>
      </div>
    </footer>
  );
}
