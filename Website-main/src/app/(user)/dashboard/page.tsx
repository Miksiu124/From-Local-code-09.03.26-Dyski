import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    ? statsData.totalModels // If bundle, user access count = total active models
    : accessData.modelIds.length;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">{t("title")}</h1>

      {/* Stats */}
      {/* Stats */}
      <div className="grid gap-6 md:grid-cols-3 mb-10">
        {/* Credits Card */}
        <div className="glass-panel p-6 rounded-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Coins className="h-16 w-16 text-primary" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Credit Balance</h3>
              <Coins className="h-5 w-5 text-primary" />
            </div>
            <div className="text-3xl font-bold text-white mb-2">{formatCredits(me.creditBalance)}</div>
            <Link href="/purchase" className="inline-flex items-center text-xs text-primary hover:text-primary/80 font-medium transition-colors">
              Buy more credits <span className="ml-1">→</span>
            </Link>
          </div>
        </div>

        {/* Access Card */}
        <div className="glass-panel p-6 rounded-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <FolderOpen className="h-16 w-16 text-blue-500" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Content Access</h3>
              <FolderOpen className="h-5 w-5 text-blue-500" />
            </div>
            <div className="text-3xl font-bold text-white mb-2">
              {accessData.hasBundle ? "Lifetime" : accessCount}
            </div>
            <p className="text-xs text-muted-foreground">
              {accessData.hasBundle ? "Unlimited access active" : "models accessible"}
            </p>
          </div>
        </div>

        {/* Notifications Card */}
        <div className="glass-panel p-6 rounded-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Bell className="h-16 w-16 text-yellow-500" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Notifications</h3>
              <Bell className="h-5 w-5 text-yellow-500" />
            </div>
            <div className="text-3xl font-bold text-white mb-2">{notificationsData.length}</div>
            <p className="text-xs text-muted-foreground">unread updates</p>
          </div>
        </div>
      </div>

      {/* Recent Credit Purchases */}
      <div className="mb-12">
        <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          {t("creditHistory")}
        </h2>
        {creditPurchasesData.length === 0 ? (
          <div className="glass-panel p-12 flex flex-col items-center justify-center text-center rounded-xl border-dashed border-white/10">
            <div className="bg-white/5 p-4 rounded-full mb-4">
              <CreditCard className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground font-medium mb-1">No credit purchases yet</p>
            <p className="text-muted-foreground/60 text-sm mb-6 max-w-xs">
              Purchase a credit package to start accessing premium content.
            </p>
            <Link
              href="/purchase"
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-md text-sm font-medium transition-colors"
            >
              Browse Packages
            </Link>
          </div>
        ) : (
          <div className="glass-panel rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/5 border-b border-white/5">
                <tr>
                  <th className="p-4 text-left font-medium text-muted-foreground">Package</th>
                  <th className="p-4 text-left font-medium text-muted-foreground">Credits</th>
                  <th className="p-4 text-left font-medium text-muted-foreground">Amount</th>
                  <th className="p-4 text-left font-medium text-muted-foreground">Status</th>
                  <th className="p-4 text-left font-medium text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {creditPurchasesData.map((cp) => (
                  <tr key={cp.id} className="hover:bg-white/5 transition-colors">
                    <td className="p-4 font-medium text-white">{cp.creditPackage.name}</td>
                    <td className="p-4 text-white/80">{cp.credits}</td>
                    <td className="p-4 text-white/80">{formatPrice(cp.amount)}</td>
                    <td className="p-4">
                      <Badge
                        className="font-normal"
                        variant={
                          cp.status === "APPROVED"
                            ? "success"
                            : cp.status === "PENDING"
                              ? "warning"
                              : cp.status === "REJECTED"
                                ? "destructive"
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
        )}
      </div>

      {/* Recent Model Purchases */}
      <div>
        <h2 className="text-xl font-semibold mb-4">{t("myPurchases")}</h2>
        {purchasesData.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <PackageOpen className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground text-sm font-medium mb-1">
                No model purchases yet
              </p>
              <p className="text-muted-foreground/60 text-xs mb-4 max-w-xs">
                Unlock access to models by spending credits from your balance.
              </p>
              <Link
                href="/models"
                className="text-sm text-primary hover:underline font-medium"
              >
                Explore models
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-3 text-left">Type</th>
                  <th className="p-3 text-left">Model</th>
                  <th className="p-3 text-left">Credits</th>
                  <th className="p-3 text-left">Date</th>
                </tr>
              </thead>
              <tbody>
                {purchasesData.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="p-3">
                      <Badge variant={p.purchaseType === "BUNDLE" ? "default" : "secondary"}>
                        {p.purchaseType === "BUNDLE" ? "Bundle" : "Model"}
                      </Badge>
                    </td>
                    <td className="p-3">{p.model?.name || "All Models"}</td>
                    <td className="p-3">{p.creditsSpent}</td>
                    <td className="p-3 text-muted-foreground">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Notifications */}
      <div className="mt-8">
        <h2 className="text-xl font-semibold mb-4">Recent Notifications</h2>
        {notificationsData.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <BellOff className="h-10 w-10 text-muted-foreground/40 mb-3" />
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
              <div key={n.id} className="rounded-lg border border-border p-4">
                <p className="font-medium text-sm">{n.title}</p>
                <p className="text-sm text-muted-foreground">{n.message}</p>
                <p className="text-xs text-muted-foreground mt-1">
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
