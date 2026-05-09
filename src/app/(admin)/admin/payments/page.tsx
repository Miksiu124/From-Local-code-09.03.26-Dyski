import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { fetchApi } from "@/lib/api-client";
import { getServerUser } from "@/lib/session-server";
import { PaymentsDashboard } from "@/components/admin/payments-dashboard";
import { resolvePaymentsAdminScope } from "@/lib/payments-admin-scope";

interface SettingItem {
  key: string;
  value: unknown;
  description: string | null;
}

function normalizeSearchParams(raw: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const sp: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    sp[k] = Array.isArray(v) ? v[0] : v;
  }
  return sp;
}

function isProbablyIsoDateTime(v: string | undefined): v is string {
  if (!v) return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

function buildHistoryQuery(sp: Record<string, string | undefined>, currentAdminId: string | undefined): string {
  const p = new URLSearchParams();
  if (isProbablyIsoDateTime(sp.from)) p.set("from", sp.from);
  if (isProbablyIsoDateTime(sp.to)) p.set("to", sp.to);
  for (const key of ["paymentMethod", "q", "status"] as const) {
    const v = sp[key];
    if (v) p.set(key, v);
  }
  const scopeRaw = (sp.adminScope ?? "").trim();
  const scoped = resolvePaymentsAdminScope(scopeRaw || undefined, currentAdminId);
  if (scoped.adminId) {
    p.set("adminId", scoped.adminId);
  } else if (scoped.partnerOnly) {
    p.set("partnerOnly", "1");
  } else if ((!scopeRaw || scopeRaw === "all") && sp.adminId?.trim()) {
    p.set("adminId", sp.adminId.trim());
  }
  p.set("limit", "80");
  p.set("sortBy", "createdAt");
  p.set("sortDir", "desc");
  return p.toString();
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminPaymentsPage({ searchParams }: PageProps) {
  const t = await getTranslations("admin");
  const rawSp = await searchParams;
  const sp = normalizeSearchParams(rawSp);
  const highlightId = sp.id;

  const me = await getServerUser();
  const meId = me?.id;

  const historyQs = buildHistoryQuery(sp, meId ?? undefined);

  const [
    pendingRes,
    histRes,
    statsToday,
    stats7d,
    stats30d,
    statsSince,
    settlementsRes,
    settings,
  ] = await Promise.all([
    fetchApi<{ purchases: Record<string, unknown>[] }>("/admin/credits/purchases?status=PENDING&limit=200").catch(() => ({
      purchases: [],
    })),
    fetchApi<{ purchases: Record<string, unknown>[]; nextCursor?: { createdAt: string; id: string } | null }>(
      `/admin/credits/purchases?${historyQs}`,
    ).catch(() => ({ purchases: [], nextCursor: null })),
    fetchApi<Record<string, unknown>>("/admin/credits/purchases/stats?range=today").catch(() => null),
    fetchApi<Record<string, unknown>>("/admin/credits/purchases/stats?range=7d").catch(() => null),
    fetchApi<Record<string, unknown>>("/admin/credits/purchases/stats?range=30d").catch(() => null),
    fetchApi<Record<string, unknown>>("/admin/credits/purchases/stats?range=since_settlement").catch(() => null),
    fetchApi<{ settlements: Record<string, unknown>[] }>("/admin/revenue/settlements?limit=15").catch(() => ({ settlements: [] })),
    fetchApi<SettingItem[]>("/admin/settings").catch(() => [] as SettingItem[]),
  ]);

  const pendingRaw = pendingRes?.purchases ?? [];
  const historyRows = histRes?.purchases ?? [];
  const nextCursor = histRes?.nextCursor ?? null;
  const settlements = settlementsRes?.settlements ?? [];

  const blikSetting = (settings ?? []).find((s) => s.key === "blik_enabled");
  const blikEnabled = blikSetting ? (blikSetting.value === true || blikSetting.value === "true") : true;

  if (!meId) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-2">{t("creditPurchases")}</h1>
        <p className="text-muted-foreground text-sm">Session required.</p>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="p-6 animate-pulse space-y-4">
          <div className="h-8 w-48 rounded-lg bg-white/10" />
          <div className="h-40 rounded-2xl bg-white/5" />
        </div>
      }
    >
      <PaymentsDashboard
        pendingPurchases={pendingRaw}
        initialHistory={historyRows}
        historyNextCursor={nextCursor}
        statsToday={statsToday}
        stats7d={stats7d}
        stats30d={stats30d}
        statsSince={statsSince}
        settlements={settlements}
        currentUserId={meId}
        highlightId={highlightId}
        initialBlikEnabled={blikEnabled}
      />
    </Suspense>
  );
}
