import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, ShoppingCart, FolderOpen, Bell, CreditCard, PackageOpen, BellOff } from "lucide-react";
import { formatCredits, formatPrice } from "@/lib/utils";
import Link from "next/link";
import { fetchApi } from "@/lib/api-client";

type ModelPurchase = {
  id: string;
  purchaseType: string;
  creditsSpent: number;
  createdAt: string;
  model: { name: string | null };
};

type CreditPurchase = {
  id: string;
  credits: number;
  amount: number;
  status: string;
  createdAt: string;
  creditPackage: { name: string };
};

type Notification = {
  id: string;
  title: string;
  message: string;
  createdAt: string;
};

type AccessResponse = {
  hasBundle: boolean;
  modelIds: string[];
};

type StatsResponse = {
  totalModels: number;
};

type MeResponse = {
  creditBalance: number;
};

export default async function DashboardPage() {
  const me = await fetchApi<MeResponse>("/auth/me").catch(() => null);
  if (!me) redirect("/login");

  const t = await getTranslations("dashboard");

  const [purchasesData, creditPurchasesData, accessData, notificationsData, statsData] = await Promise.all([
    fetchApi<ModelPurchase[]>("/purchases").catch(() => []),
    fetchApi<CreditPurchase[]>("/credits/purchase").catch(() => []),
    fetchApi<AccessResponse>("/user/access").catch(() => ({ hasBundle: false, modelIds: [] })),
    fetchApi<Notification[]>("/notifications").catch(() => []),
    fetchApi<StatsResponse>("/models/stats").catch(() => ({ totalModels: 0 })),
  ]);

  const accessCount = accessData.hasBundle
    ? statsData.totalModels
    : accessData.modelIds.length;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl sm:text-3xl font-bold mb-8 slide-up">{t("title")}</h1>

      {/* Stats */}
      <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-3 mb-10">
        <div className="glass-panel p-5 sm:p-6 rounded-2xl relative overflow-hidden group animate-in fade-in stagger-1">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Coins className="h-20 w-20 text-primary" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Credit Balance</h3>
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Coins className="h-4 w-4 text-primary" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-white mb-2">{formatCredits(me.creditBalance)}</div>
            <Link href="/purchase" className="inline-flex items-center text-xs text-primary hover:text-primary/80 font-medium transition-colors gap-1">
              Buy more credits <span>→</span>
            </Link>
          </div>
        </div>

        <div className="glass-panel p-5 sm:p-6 rounded-2xl relative overflow-hidden group animate-in fade-in stagger-2">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <FolderOpen className="h-20 w-20 text-blue-500" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Content Access</h3>
              <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <FolderOpen className="h-4 w-4 text-blue-500" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-white mb-2">
              {accessData.hasBundle ? "All" : accessCount}
            </div>
            <p className="text-xs text-muted-foreground">
              {accessData.hasBundle ? "Unlimited access active" : "models accessible"}
            </p>
          </div>
        </div>

        <div className="glass-panel p-5 sm:p-6 rounded-2xl relative overflow-hidden group animate-in fade-in stagger-3">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Bell className="h-20 w-20 text-yellow-500" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Notifications</h3>
              <div className="h-8 w-8 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                <Bell className="h-4 w-4 text-yellow-500" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-white mb-2">{notificationsData.length}</div>
            <p className="text-xs text-muted-foreground">unread updates</p>
          </div>
        </div>
      </div>

      {/* Recent Credit Purchases */}
      <div className="mb-12 slide-up" style={{ animationDelay: "0.2s" }}>
        <h2 className="text-lg sm:text-xl font-bold mb-5 flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          {t("creditHistory")}
        </h2>
        {creditPurchasesData.length === 0 ? (
          <div className="glass-panel p-10 sm:p-12 flex flex-col items-center justify-center text-center rounded-2xl border-dashed border-white/[0.06]">
            <div className="bg-white/[0.03] p-4 rounded-2xl mb-4">
              <CreditCard className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <p className="text-muted-foreground font-medium mb-1">No credit purchases yet</p>
            <p className="text-muted-foreground/60 text-sm mb-6 max-w-xs">
              Purchase a credit package to start accessing premium content.
            </p>
            <Link
              href="/purchase"
              className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-medium transition-colors"
            >
              Browse Packages
            </Link>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="glass-panel rounded-2xl overflow-hidden hidden sm:block">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.03] border-b border-white/[0.05]">
                  <tr>
                    <th className="p-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Package</th>
                    <th className="p-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Credits</th>
                    <th className="p-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Amount</th>
                    <th className="p-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Status</th>
                    <th className="p-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {creditPurchasesData.map((cp) => (
                    <tr key={cp.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4 font-medium text-white">{cp.creditPackage.name}</td>
                      <td className="p-4 text-white/80">{cp.credits}</td>
                      <td className="p-4 text-white/80">{formatPrice(cp.amount)}</td>
                      <td className="p-4">
                        <Badge
                          className="font-normal text-[10px]"
                          variant={
                            cp.status === "APPROVED" ? "success"
                              : cp.status === "PENDING" ? "warning"
                              : cp.status === "REJECTED" ? "destructive"
                              : "secondary"
                          }
                        >
                          {cp.status}
                        </Badge>
                      </td>
                      <td className="p-4 text-muted-foreground">
                        {new Date(cp.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="flex flex-col gap-3 sm:hidden">
              {creditPurchasesData.map((cp) => (
                <div key={cp.id} className="glass-panel p-4 rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm text-white">{cp.creditPackage.name}</span>
                    <Badge
                      className="font-normal text-[10px]"
                      variant={
                        cp.status === "APPROVED" ? "success"
                          : cp.status === "PENDING" ? "warning"
                          : cp.status === "REJECTED" ? "destructive"
                          : "secondary"
                      }
                    >
                      {cp.status}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{cp.credits} credits</span>
                    <span>{formatPrice(cp.amount)}</span>
                    <span>{new Date(cp.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Recent Model Purchases */}
      <div className="slide-up" style={{ animationDelay: "0.3s" }}>
        <h2 className="text-lg sm:text-xl font-bold mb-5 flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-primary" />
          {t("myPurchases")}
        </h2>
        {purchasesData.length === 0 ? (
          <Card className="border-dashed border-white/[0.06]">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <div className="bg-white/[0.03] p-4 rounded-2xl mb-4">
                <PackageOpen className="h-8 w-8 text-muted-foreground/40" />
              </div>
              <p className="text-muted-foreground text-sm font-medium mb-1">
                No model purchases yet
              </p>
              <p className="text-muted-foreground/60 text-xs mb-4 max-w-xs">
                Unlock access to models by spending credits from your balance.
              </p>
              <Link
                href="/"
                className="text-sm text-primary hover:text-primary/80 font-medium transition-colors"
              >
                Explore models
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Desktop table */}
            <div className="rounded-2xl border border-white/[0.06] overflow-hidden hidden sm:block">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.03]">
                  <tr>
                    <th className="p-3 text-left text-xs uppercase tracking-wider text-muted-foreground font-medium">Type</th>
                    <th className="p-3 text-left text-xs uppercase tracking-wider text-muted-foreground font-medium">Model</th>
                    <th className="p-3 text-left text-xs uppercase tracking-wider text-muted-foreground font-medium">Credits</th>
                    <th className="p-3 text-left text-xs uppercase tracking-wider text-muted-foreground font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {purchasesData.map((p) => (
                    <tr key={p.id} className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="p-3">
                        <Badge variant={p.purchaseType === "BUNDLE" ? "default" : "secondary"}>
                          {p.purchaseType === "BUNDLE" ? "Bundle" : "Model"}
                        </Badge>
                      </td>
                      <td className="p-3 text-white">{p.model?.name || "All Models"}</td>
                      <td className="p-3 text-white/80">{p.creditsSpent}</td>
                      <td className="p-3 text-muted-foreground">
                        {new Date(p.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="flex flex-col gap-3 sm:hidden">
              {purchasesData.map((p) => (
                <div key={p.id} className="rounded-xl border border-white/[0.06] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm text-white">{p.model?.name || "All Models"}</span>
                    <Badge variant={p.purchaseType === "BUNDLE" ? "default" : "secondary"} className="text-[10px]">
                      {p.purchaseType === "BUNDLE" ? "Bundle" : "Model"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{p.creditsSpent} credits</span>
                    <span>{new Date(p.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Notifications */}
      <div className="mt-10 slide-up" style={{ animationDelay: "0.4s" }}>
        <h2 className="text-lg sm:text-xl font-bold mb-5 flex items-center gap-2">
          <Bell className="h-5 w-5 text-yellow-500" />
          Recent Notifications
        </h2>
        {notificationsData.length === 0 ? (
          <Card className="border-dashed border-white/[0.06]">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <div className="bg-white/[0.03] p-4 rounded-2xl mb-4">
                <BellOff className="h-8 w-8 text-muted-foreground/40" />
              </div>
              <p className="text-muted-foreground text-sm font-medium mb-1">
                All caught up!
              </p>
              <p className="text-muted-foreground/60 text-xs max-w-xs">
                You have no unread notifications. We&apos;ll let you know when something new comes in.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {notificationsData.map((n) => (
              <div key={n.id} className="rounded-xl border border-white/[0.06] p-4 hover:bg-white/[0.02] transition-colors">
                <p className="font-medium text-sm">{n.title}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{n.message}</p>
                <p className="text-xs text-muted-foreground/60 mt-2">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
