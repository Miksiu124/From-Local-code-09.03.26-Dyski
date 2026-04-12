import { getTranslations } from "next-intl/server";
import { fetchApi } from "@/lib/api-client";
import { AdminPaymentsList } from "@/components/admin/admin-payments-list";
import { parseReferralReferrer } from "@/lib/referral-referrer";

interface ApiPurchase {
  id: string;
  credits: number;
  amount: number;
  paymentMethod: string;
  transactionCode: string;
  blikCode: string | null;
  cryptoCurrency: string | null;
  txId: string | null;
  status: string;
  paymentProofUrl: string | null;
  adminNotes: string | null;
  expirationTime: string;
  createdAt: string;
  fromCustomLink?: boolean;
  customLinkSlug?: string | null;
  fromUserReferral?: boolean;
  referralReferrer?: { id: string; email: string; name: string | null } | null;
  user: { id: string; email: string; name: string | null };
  creditPackage: { name: string; credits: number; price: number };
}

interface SettingItem {
  key: string;
  value: unknown;
  description: string | null;
}

interface PageProps {
  searchParams: Promise<{ id?: string }>;
}

export default async function AdminPaymentsPage({ searchParams }: PageProps) {
  const t = await getTranslations("admin");
  const { id: highlightId } = await searchParams;

  const data = await fetchApi<{ purchases: ApiPurchase[] }>("/admin/credits/purchases").catch(() => ({ purchases: [] }));
  const allPurchases = data?.purchases ?? [];

  const pendingPurchases = allPurchases
    .filter((p) => p.status === "PENDING")
    .map((p) => ({
      id: p.id,
      userEmail: p.user?.email ?? "—",
      userName: p.user?.name ?? null,
      packageName: p.creditPackage?.name ?? "—",
      credits: p.credits,
      amount: p.amount,
      paymentMethod: p.paymentMethod,
      transactionCode: p.transactionCode,
      blikCode: p.blikCode,
      cryptoCurrency: p.cryptoCurrency,
      txId: p.txId,
      status: p.status,
      paymentProofUrl: p.paymentProofUrl,
      adminNotes: p.adminNotes,
      expirationTime: p.expirationTime,
      createdAt: p.createdAt,
      fromCustomLink: Boolean(p.fromCustomLink),
      customLinkSlug: p.customLinkSlug ?? null,
      fromUserReferral: Boolean(p.fromUserReferral),
      referralReferrer: parseReferralReferrer(p.referralReferrer),
    }));

  const settings = await fetchApi<SettingItem[]>("/admin/settings").catch(() => [] as SettingItem[]);
  const blikSetting = (settings ?? []).find((s) => s.key === "blik_enabled");
  const blikEnabled = blikSetting ? (blikSetting.value === true || blikSetting.value === "true") : true;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t("creditPurchases")}</h1>
      <AdminPaymentsList purchases={pendingPurchases} initialBlikEnabled={blikEnabled} highlightId={highlightId} />
    </div>
  );
}
