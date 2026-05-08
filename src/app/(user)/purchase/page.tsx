import { Suspense } from "react";
import { CreditPurchaseFlow } from "@/components/payments/credit-purchase-flow";
import { CreditPricingPreview } from "@/components/payments/credit-pricing-preview";
import { fetchApi } from "@/lib/api-client";

type MeResponse = {
  creditBalance: number;
  approvedCreditPurchasesCount?: number;
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

  const [packages, publicSettings] = await Promise.all([
    fetchApi<CreditPackage[]>("/credit-packages").catch(() => []),
    fetchApi<Record<string, unknown>>("/settings/public").catch((): Record<string, unknown> => ({})),
  ]);

  const blikEnabled = publicSettings?.blik_enabled !== false && publicSettings?.blik_enabled !== "false";

  if (!me) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <CreditPricingPreview
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

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <Suspense fallback={<div className="text-center text-muted-foreground py-12">…</div>}>
        <CreditPurchaseFlow
          creditBalance={me.creditBalance}
          priorApprovedCreditPurchases={me.approvedCreditPurchasesCount ?? 0}
          packages={packages.map((p) => ({
            id: p.id,
            name: p.name,
            credits: p.credits,
            price: Number(p.price),
            tier: p.tier,
          }))}
          blikEnabled={blikEnabled}
        />
      </Suspense>
    </div>
  );
}
