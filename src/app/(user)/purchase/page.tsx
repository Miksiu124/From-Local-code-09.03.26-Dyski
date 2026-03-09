import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CreditPurchaseFlow } from "@/components/payments/credit-purchase-flow";
import { formatCredits } from "@/lib/utils";
import { fetchApi } from "@/lib/api-client";
import { Coins } from "lucide-react";

type MeResponse = {
  creditBalance: number;
};

type CreditPackage = {
  id: string;
  name: string;
  credits: number;
  price: number;
  tier: number;
};

export default async function PurchasePage() {
  const me = await fetchApi<MeResponse>("/auth/me").catch(() => null);
  if (!me) redirect("/login");

  const t = await getTranslations("credits");

  const [packages, publicSettings] = await Promise.all([
    fetchApi<CreditPackage[]>("/credit-packages").catch(() => []),
    fetchApi<Record<string, unknown>>("/settings/public").catch((): Record<string, unknown> => ({})),
  ]);

  const blikEnabled = publicSettings?.blik_enabled !== false && publicSettings?.blik_enabled !== "false";

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="slide-up">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">{t("title")}</h1>
        <div className="flex items-center gap-2 text-muted-foreground mb-4">
          <Coins className="h-4 w-4 text-primary" />
          <p className="text-sm">
            {t("balance")}: <span className="text-foreground font-semibold">{formatCredits(me.creditBalance)}</span> {t("creditsLabel")}
          </p>
        </div>
      </div>

      <CreditPurchaseFlow
        packages={packages.map((p) => ({
          id: p.id,
          name: p.name,
          credits: p.credits,
          price: Number(p.price),
          tier: p.tier,
        }))}
        blikEnabled={blikEnabled}
      />
    </div>
  );
}
