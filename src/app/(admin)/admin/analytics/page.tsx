"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  Users,
  DollarSign,
  Coins,
  FolderOpen,
  ShoppingCart,
  TrendingUp,
  Package,
  RefreshCw,
  BarChart3,
  UserPlus,
  MousePointerClick,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";
import { formatPrice } from "@/lib/utils";

interface Analytics {
  users: { total: number; new7d: number; new30d: number };
  content: { totalModels: number; activeModels: number; totalContentItems: number };
  credits: { totalIssued: number; totalSpent: number };
  revenue: { total: number; last30d: number; last7d: number };
  creditPurchases: {
    byStatus: { status: string; count: number; amount: number }[];
    byMethod: { method: string; count: number; amount: number }[];
  };
  purchases: { total: number; bundles: number; individual: number };
  topSellers: {
    modelId: string;
    modelName: string;
    purchaseCount: number;
    creditsEarned: number;
  }[];
  referral?: {
    clicks: number;
    registrations: number;
    revenue: number;
  };
}

type SortDir = "asc" | "desc";
type TopSortKey = "modelName" | "purchaseCount" | "creditsEarned";
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: any;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-500/10 text-yellow-500",
  APPROVED: "bg-green-500/10 text-green-500",
  REJECTED: "bg-red-500/10 text-red-500",
  EXPIRED: "bg-gray-500/10 text-gray-400",
};

const METHOD_LABELS: Record<string, string> = {
  BLIK: "BLIK",
  CRYPTO: "Crypto",
  PAYPAL: "PayPal",
  REVOLUT: "Revolut",
};

export default function AdminAnalyticsPage() {
  const t = useTranslations("admin");
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [topSortKey, setTopSortKey] = useState<TopSortKey>("purchaseCount");
  const [topSortDir, setTopSortDir] = useState<SortDir>("desc");
  const [topPage, setTopPage] = useState(0);
  const TOP_PAGE_SIZE = 20;

  const fetchAnalytics = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const params = new URLSearchParams({
        topSortBy: topSortKey,
        topSortDir: topSortDir,
      });
      const res = await fetch(`/api/admin/analytics?${params.toString()}`, { credentials: "include" });
      if (res.ok) setData(await res.json());
    } catch (e) {
      logger.error("Failed to fetch analytics", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [topSortKey, topSortDir]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading analytics...
      </div>
    );
  }

  if (!data) {
    return <div className="py-20 text-center text-muted-foreground">Failed to load analytics.</div>;
  }

  const fmtCurrency = (n: number) => formatPrice(n);

  const handleTopSort = (key: TopSortKey) => {
    if (topSortKey === key) {
      setTopSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setTopSortKey(key);
    setTopSortDir("asc");
  };

  const renderTopSortIndicator = (key: TopSortKey) => {
    if (topSortKey !== key) return null;
    return topSortDir === "asc" ? "▲" : "▼";
  };

  return (
    <div className="space-y-8 max-h-[calc(100vh-8rem)] overflow-y-auto pr-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">{t("analytics")}</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchAnalytics(true)}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Top-level stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <StatCard icon={DollarSign} label="Total Revenue" value={fmtCurrency(data.revenue.total)} sub={`Last 7d: ${fmtCurrency(data.revenue.last7d)}`} />
        <StatCard icon={DollarSign} label="Revenue (30d)" value={fmtCurrency(data.revenue.last30d)} />
        <StatCard icon={Users} label="Total Users" value={data.users.total} sub={`+${data.users.new7d} (7d), +${data.users.new30d} (30d)`} />
        <StatCard icon={Coins} label="Credits Issued" value={data.credits.totalIssued} sub={`Spent: ${data.credits.totalSpent}`} />
        <StatCard icon={FolderOpen} label="Models" value={`${data.content.activeModels} / ${data.content.totalModels}`} sub={`${data.content.totalContentItems} content items`} />
        <StatCard icon={ShoppingCart} label="Model Purchases" value={data.purchases.total} sub={`${data.purchases.bundles} bundles, ${data.purchases.individual} individual`} />
        <StatCard icon={TrendingUp} label="Conversion" value={data.users.total > 0 ? `${Math.round((data.purchases.total / data.users.total) * 100)}%` : "0%"} sub="Users who purchased" />
        <StatCard icon={Package} label="Avg Purchase" value={data.purchases.total > 0 ? fmtCurrency(data.revenue.total / data.purchases.total) : fmtCurrency(0)} />
        {data.referral && (
          <div className="bg-card rounded-xl border border-border p-5 col-span-2 md:col-span-1">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <UserPlus className="h-5 w-5 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground">Referral Program</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-lg font-bold">{data.referral.clicks}</p>
                <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1"><MousePointerClick className="h-3 w-3" /> Clicks</p>
              </div>
              <div>
                <p className="text-lg font-bold">{data.referral.registrations}</p>
                <p className="text-[10px] text-muted-foreground">Registrations</p>
              </div>
              <div>
                <p className="text-lg font-bold">{fmtCurrency(data.referral.revenue)}</p>
                <p className="text-[10px] text-muted-foreground">Revenue</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Two-column row: Payment Status Breakdown + Payment Method Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Payment status breakdown */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h2 className="text-lg font-semibold mb-4">Credit Purchase Status</h2>
          <div className="space-y-3">
            {data.creditPurchases.byStatus.length === 0 && (
              <p className="text-muted-foreground text-sm">No credit purchases yet.</p>
            )}
            {data.creditPurchases.byStatus.map((s) => (
              <div key={s.status} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge className={STATUS_COLORS[s.status] || "bg-secondary"}>
                    {s.status}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{s.count} purchases</span>
                </div>
                <span className="font-medium text-sm">{fmtCurrency(s.amount)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Payment method breakdown */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h2 className="text-lg font-semibold mb-4">Payment Methods (Approved)</h2>
          <div className="space-y-3">
            {data.creditPurchases.byMethod.length === 0 && (
              <p className="text-muted-foreground text-sm">No approved payments yet.</p>
            )}
            {data.creditPurchases.byMethod.map((m) => {
              const total = data.creditPurchases.byMethod.reduce((acc, x) => acc + x.count, 0);
              const pct = total > 0 ? Math.round((m.count / total) * 100) : 0;
              return (
                <div key={m.method}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">
                      {METHOD_LABELS[m.method] || m.method}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {m.count} ({pct}%) - {fmtCurrency(m.amount)}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top Sellers */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h2 className="text-lg font-semibold mb-4">Top Selling Models</h2>
        {data.topSellers.length === 0 ? (
          <p className="text-muted-foreground text-sm">No model purchases yet.</p>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4">#</th>
                  <th className="text-left py-2 pr-4">
                    <button
                      type="button"
                      onClick={() => handleTopSort("modelName")}
                      className="inline-flex items-center gap-2 hover:text-foreground"
                    >
                      Model {renderTopSortIndicator("modelName")}
                    </button>
                  </th>
                  <th className="text-right py-2 pr-4">
                    <button
                      type="button"
                      onClick={() => handleTopSort("purchaseCount")}
                      className="inline-flex items-center gap-2 hover:text-foreground"
                    >
                      Purchases {renderTopSortIndicator("purchaseCount")}
                    </button>
                  </th>
                  <th className="text-right py-2">
                    <button
                      type="button"
                      onClick={() => handleTopSort("creditsEarned")}
                      className="inline-flex items-center gap-2 hover:text-foreground"
                    >
                      Credits Earned {renderTopSortIndicator("creditsEarned")}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.topSellers
                  .slice(topPage * TOP_PAGE_SIZE, (topPage + 1) * TOP_PAGE_SIZE)
                  .map((ts, i) => (
                    <tr key={ts.modelId} className="border-b border-border/50">
                      <td className="py-2.5 pr-4 text-muted-foreground">{topPage * TOP_PAGE_SIZE + i + 1}</td>
                      <td className="py-2.5 pr-4 font-medium">{ts.modelName}</td>
                      <td className="py-2.5 pr-4 text-right">{ts.purchaseCount}</td>
                      <td className="py-2.5 text-right">{ts.creditsEarned}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {data.topSellers.length > TOP_PAGE_SIZE && (
              <div className="flex items-center justify-between pt-3 border-t border-border mt-2">
                <span className="text-xs text-muted-foreground">
                  {topPage * TOP_PAGE_SIZE + 1}-{Math.min((topPage + 1) * TOP_PAGE_SIZE, data.topSellers.length)} of {data.topSellers.length}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={topPage === 0}
                    onClick={() => setTopPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(topPage + 1) * TOP_PAGE_SIZE >= data.topSellers.length}
                    onClick={() => setTopPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
