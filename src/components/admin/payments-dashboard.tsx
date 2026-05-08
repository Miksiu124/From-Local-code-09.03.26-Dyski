"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp, LayoutDashboard } from "lucide-react";
import { AdminPaymentsList } from "@/components/admin/admin-payments-list";
import { parseReferralReferrer } from "@/lib/referral-referrer";
import { RevenueKpiCards } from "@/components/admin/revenue-kpi-cards";
import { RevenueSplitBar } from "@/components/admin/revenue-split-bar";
import { RevenueCanvasChart } from "@/components/admin/revenue-canvas-chart";
import { PaymentsFilters } from "@/components/admin/payments-filters";
import { PaymentsHistoryTable } from "@/components/admin/payments-history-table";
import { SettlementDialog } from "@/components/admin/settlement-dialog";
import { SettlementsHistory } from "@/components/admin/settlements-history";
import { Button } from "@/components/ui/button";
import { resolvePaymentsAdminScope } from "@/lib/payments-admin-scope";
import { formatPrice } from "@/lib/utils";

export type StatsPayload = Record<string, unknown> | null;

export interface PaymentsDashboardProps {
  pendingPurchases: Record<string, unknown>[];
  initialHistory: Record<string, unknown>[];
  historyNextCursor: { createdAt: string; id: string } | null;
  statsToday: StatsPayload;
  stats7d: StatsPayload;
  stats30d: StatsPayload;
  statsSince: StatsPayload;
  settlements: Record<string, unknown>[];
  currentUserId: string;
  highlightId?: string;
  initialBlikEnabled: boolean;
}

function readApprovedStats(s: StatsPayload): { totalAmount: number; count: number } {
  if (!s || typeof s !== "object") return { totalAmount: 0, count: 0 };
  const approved = (s as { approved?: { totalAmount?: number; count?: number } }).approved;
  return {
    totalAmount: Number(approved?.totalAmount ?? 0),
    count: Number(approved?.count ?? 0),
  };
}

export function PaymentsDashboard({
  pendingPurchases,
  initialHistory,
  historyNextCursor,
  statsToday,
  stats7d,
  stats30d,
  statsSince,
  settlements,
  currentUserId,
  highlightId,
  initialBlikEnabled,
}: PaymentsDashboardProps) {
  const t = useTranslations("admin.payments");
  const tAdmin = useTranslations("admin");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendingOpen, setPendingOpen] = useState(true);
  const [historyRows, setHistoryRows] = useState(initialHistory);
  const [nextCursor, setNextCursor] = useState(historyNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedRangeStats, setSelectedRangeStats] = useState<StatsPayload>(null);
  const [selectedRangeLoading, setSelectedRangeLoading] = useState(false);

  const qKey = useMemo(() => searchParams.toString(), [searchParams]);
  const skipFirst = useRef(true);

  const apiPurchaseParams = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    const scope = params.get("adminScope");
    params.delete("adminScope");
    params.delete("adminId");
    params.delete("partnerOnly");
    const scoped = resolvePaymentsAdminScope(scope);
    if (scoped.adminId) params.set("adminId", scoped.adminId);
    if (scoped.partnerOnly) params.set("partnerOnly", "1");
    params.set("limit", "80");
    params.set("sortBy", "createdAt");
    params.set("sortDir", "desc");
    return params;
  }, [searchParams, currentUserId]);

  const refetchHistory = useCallback(async () => {
    const params = apiPurchaseParams();
    const res = await fetch(`/api/admin/credits/purchases?${params.toString()}`, { credentials: "include" });
    if (!res.ok) return;
    const inner = (await res.json()) as { purchases?: Record<string, unknown>[]; nextCursor?: { createdAt: string; id: string } | null };
    const purchases = inner.purchases ?? [];
    const nc = inner.nextCursor ?? null;
    setHistoryRows(purchases);
    setNextCursor(nc);
  }, [apiPurchaseParams]);

  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    void refetchHistory();
  }, [qKey, refetchHistory]);

  useEffect(() => {
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || new Date(to) <= new Date(from)) {
      setSelectedRangeStats(null);
      setSelectedRangeLoading(false);
      return;
    }

    let disposed = false;
    setSelectedRangeLoading(true);
    void (async () => {
      try {
        const p = new URLSearchParams();
        p.set("range", "custom");
        p.set("from", from);
        p.set("to", to);
        const res = await fetch(`/api/admin/credits/purchases/stats?${p.toString()}`, { credentials: "include" });
        if (!res.ok) throw new Error("stats fetch failed");
        const payload = (await res.json()) as StatsPayload;
        if (!disposed) setSelectedRangeStats(payload);
      } catch {
        if (!disposed) setSelectedRangeStats(null);
      } finally {
        if (!disposed) setSelectedRangeLoading(false);
      }
    })();

    return () => {
      disposed = true;
    };
  }, [searchParams]);

  const selectedRangeSummary = useMemo(() => {
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!from || !to) return null;
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return null;
    const { totalAmount, count } = readApprovedStats(selectedRangeStats);
    return {
      fromText: fromDate.toLocaleString(),
      toText: toDate.toLocaleString(),
      totalAmount,
      count,
    };
  }, [searchParams, selectedRangeStats]);

  const loadMore = useCallback(async () => {
    if (!nextCursor?.createdAt || !nextCursor?.id || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = apiPurchaseParams();
      params.set("cursorBefore", nextCursor.createdAt);
      params.set("cursorBeforeId", nextCursor.id);
      const res = await fetch(`/api/admin/credits/purchases?${params.toString()}`, { credentials: "include" });
      if (!res.ok) return;
      const inner = (await res.json()) as { purchases?: Record<string, unknown>[]; nextCursor?: { createdAt: string; id: string } | null };
      const more = inner.purchases ?? [];
      const nc = inner.nextCursor ?? null;
      setHistoryRows((prev) => [...prev, ...more]);
      setNextCursor(nc);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, apiPurchaseParams]);

  const mapPending = pendingPurchases.map((p) => ({
    id: String(p.id ?? ""),
    userEmail: (p.user as { email?: string })?.email ?? "—",
    userName: (p.user as { name?: string | null })?.name ?? null,
    packageName: (p.creditPackage as { name?: string })?.name ?? "—",
    credits: Number(p.credits ?? 0),
    amount: Number(p.amount ?? 0),
    paymentMethod: String(p.paymentMethod ?? ""),
    transactionCode: String(p.transactionCode ?? ""),
    blikCode: (p.blikCode as string | null | undefined) ?? null,
    cryptoCurrency: (p.cryptoCurrency as string | null | undefined) ?? null,
    txId: (p.txId as string | null | undefined) ?? null,
    status: String(p.status ?? "PENDING"),
    paymentProofUrl: (p.paymentProofUrl as string | null | undefined) ?? null,
    adminNotes: (p.adminNotes as string | null | undefined) ?? null,
    expirationTime: String(p.expirationTime ?? ""),
    createdAt: String(p.createdAt ?? ""),
    fromCustomLink: Boolean(p.fromCustomLink),
    customLinkSlug: (p.customLinkSlug as string | null | undefined) ?? null,
    fromUserReferral: Boolean(p.fromUserReferral),
    referralReferrer: parseReferralReferrer(p.referralReferrer),
  }));

  return (
    <div className="space-y-8 pb-16">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium">
            <LayoutDashboard className="h-4 w-4" />
            <span>{t("revenueDashboard")}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1 bg-gradient-to-r from-foreground via-foreground to-primary/80 bg-clip-text text-transparent">
            {tAdmin("creditPurchases")}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setSettleOpen(true)} className="rounded-xl">
            {t("settleNow")}
          </Button>
        </div>
      </header>

      <section className="rounded-2xl border border-white/[0.08] bg-card/40 overflow-hidden shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
        <button
          type="button"
          onClick={() => setPendingOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.04] transition-colors"
          aria-expanded={pendingOpen}
        >
          <span className="font-semibold flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]" />
            {t("pendingSection")}
            <span className="text-muted-foreground font-normal text-sm">({mapPending.length})</span>
          </span>
          {pendingOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <AnimatePresence initial={false}>
          {pendingOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="p-4 pt-0 border-t border-white/[0.06]">
                <AdminPaymentsList
                  purchases={mapPending}
                  initialBlikEnabled={initialBlikEnabled}
                  highlightId={highlightId}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <RevenueKpiCards statsToday={statsToday} stats7d={stats7d} stats30d={stats30d} statsSince={statsSince} />

      <RevenueSplitBar statsSince={statsSince} />

      <RevenueCanvasChart stats={stats7d} />

      <PaymentsFilters key={qKey} onApply={() => void refetchHistory()} />
      {(selectedRangeLoading || selectedRangeSummary) && (
        <section className="rounded-xl border border-white/[0.08] bg-card/40 px-3 py-2 text-sm">
          {selectedRangeLoading ? (
            <p className="text-muted-foreground">{t("selectedRangeLoading")}</p>
          ) : selectedRangeSummary ? (
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted-foreground">
                {t("selectedRangeSales", {
                  from: selectedRangeSummary.fromText,
                  to: selectedRangeSummary.toText,
                })}
              </p>
              <p className="font-semibold tabular-nums">
                {formatPrice(selectedRangeSummary.totalAmount)}{" "}
                <span className="font-normal text-muted-foreground">({t("selectedRangeApprovedCount", { count: selectedRangeSummary.count })})</span>
              </p>
            </div>
          ) : null}
        </section>
      )}

      <div key={qKey + String(refreshKey)}>
        <PaymentsHistoryTable rows={historyRows} currentUserId={currentUserId} />
        {nextCursor && (
          <div className="flex justify-center mt-4">
            <Button variant="secondary" size="sm" className="rounded-xl" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? "…" : t("loadMore")}
            </Button>
          </div>
        )}
      </div>

      <SettlementsHistory
        settlements={settlements}
        onUndo={() => {
          setRefreshKey((k) => k + 1);
          void refetchHistory();
        }}
      />

      <SettlementDialog
        open={settleOpen}
        onOpenChange={setSettleOpen}
        statsSince={statsSince}
        onSettled={() => {
          setRefreshKey((k) => k + 1);
          void refetchHistory();
          router.refresh();
        }}
      />
    </div>
  );
}
