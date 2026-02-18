import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CreditPurchaseFlow } from "@/components/payments/credit-purchase-flow";
import { formatCredits } from "@/lib/utils";
import { fetchApi } from "@/lib/api-client";

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

  const packages = await fetchApi<CreditPackage[]>("/credit-packages").catch(() => []);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">{t("title")}</h1>
      <p className="text-muted-foreground mb-8">
        {t("balance")}: <span className="text-foreground font-semibold">{formatCredits(me.creditBalance)}</span> {t("creditsLabel")}
      </p>

      <CreditPurchaseFlow
        packages={packages.map((p) => ({
          id: p.id,
          name: p.name,
          credits: p.credits,
          price: Number(p.price),
          tier: p.tier,
        }))}
      />
    </div>
  );
}
