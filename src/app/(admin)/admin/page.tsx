import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard, Users, Coins, BarChart3 } from "lucide-react";
import { formatPrice } from "@/lib/utils";

export default async function AdminDashboard() {
  const t = await getTranslations("admin");

  const [
    pendingPurchases,
    approvedPurchases,
    totalUsers,
    totalRevenue,
  ] = await Promise.all([
    db.creditPurchase.count({ where: { status: "PENDING" } }),
    db.creditPurchase.count({ where: { status: "APPROVED" } }),
    db.user.count(),
    db.creditPurchase.aggregate({
      where: { status: "APPROVED" },
      _sum: { amount: true },
    }),
  ]);

  const stats = [
    {
      title: t("pending"),
      value: pendingPurchases,
      icon: CreditCard,
      color: "text-warning",
    },
    {
      title: t("totalRevenue"),
      value: formatPrice(totalRevenue._sum.amount || 0),
      icon: BarChart3,
      color: "text-success",
    },
    {
      title: t("totalUsers"),
      value: totalUsers,
      icon: Users,
      color: "text-primary",
    },
    {
      title: t("approved"),
      value: approvedPurchases,
      icon: Coins,
      color: "text-primary",
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t("dashboard")}</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <Icon className={`h-4 w-4 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
