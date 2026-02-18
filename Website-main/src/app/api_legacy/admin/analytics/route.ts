import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { logger } from "@/lib/logger";

type SortDir = "asc" | "desc";
type TopSortKey = "modelName" | "purchaseCount" | "creditsEarned";
type RecentSortKey = "createdAt" | "method" | "amount" | "credits" | "status";

function normalizeSortDir(value: string | null): SortDir {
  return value === "asc" ? "asc" : "desc";
}

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email, session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const topSortKey = (searchParams.get("topSortBy") || "purchaseCount") as TopSortKey;
    const topSortDir = normalizeSortDir(searchParams.get("topSortDir"));
    const recentSortKey = (searchParams.get("recentSortBy") || "createdAt") as RecentSortKey;
    const recentSortDir = normalizeSortDir(searchParams.get("recentSortDir"));

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Run all queries in parallel
    const [
      totalUsers,
      newUsers7d,
      newUsers30d,
      totalModels,
      activeModels,
      totalContentItems,
      totalCreditsIssued,
      totalCreditsSpent,
      creditPurchasesByStatus,
      creditPurchasesByMethod,
      recentCreditPurchases,
      topModels,
      revenueTotal,
      revenue30d,
      revenue7d,
      totalPurchases,
      bundlePurchases,
      modelPurchases,
    ] = await Promise.all([
      // User stats
      db.user.count(),
      db.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      db.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),

      // Content stats
      db.model.count(),
      db.model.count({ where: { isActive: true } }),
      db.contentItem.count({ where: { isActive: true } }),

      // Credit stats
      db.creditTransaction.aggregate({
        where: { type: "PURCHASE" },
        _sum: { amount: true },
      }),
      db.creditTransaction.aggregate({
        where: { type: "SPEND" },
        _sum: { amount: true },
      }),

      // Credit purchase status breakdown
      db.creditPurchase.groupBy({
        by: ["status"],
        _count: true,
        _sum: { amount: true },
      }),

      // Credit purchase method breakdown
      db.creditPurchase.groupBy({
        by: ["paymentMethod"],
        where: { status: "APPROVED" },
        _count: true,
        _sum: { amount: true },
      }),

      // Recent credit purchases (last 30 days)
      db.creditPurchase.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: {
          id: true,
          amount: true,
          credits: true,
          status: true,
          paymentMethod: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),

      // Top models by purchases
      db.purchase.groupBy({
        by: ["modelId"],
        where: { modelId: { not: null } },
        _count: true,
        _sum: { creditsSpent: true },
        orderBy: { _count: { modelId: "desc" } },
        take: 10,
      }),

      // Revenue: total approved
      db.creditPurchase.aggregate({
        where: { status: "APPROVED" },
        _sum: { amount: true },
      }),

      // Revenue: last 30 days
      db.creditPurchase.aggregate({
        where: { status: "APPROVED", createdAt: { gte: thirtyDaysAgo } },
        _sum: { amount: true },
      }),

      // Revenue: last 7 days
      db.creditPurchase.aggregate({
        where: { status: "APPROVED", createdAt: { gte: sevenDaysAgo } },
        _sum: { amount: true },
      }),

      // Purchase stats
      db.purchase.count(),
      db.purchase.count({ where: { purchaseType: "BUNDLE" } }),
      db.purchase.count({ where: { purchaseType: "INDIVIDUAL_MODEL" } }),
    ]);

    // Resolve model names for top models
    const topModelIds = topModels
      .map((tm) => tm.modelId)
      .filter((id): id is string => id !== null);

    const modelNames = topModelIds.length > 0
      ? await db.model.findMany({
          where: { id: { in: topModelIds } },
          select: { id: true, name: true },
        })
      : [];

    const modelNameMap = new Map(modelNames.map((m) => [m.id, m.name]));

    const topSellers = topModels.map((tm) => ({
      modelId: tm.modelId,
      modelName: tm.modelId ? modelNameMap.get(tm.modelId) || "Unknown" : "Unknown",
      purchaseCount: tm._count,
      creditsEarned: tm._sum.creditsSpent || 0,
    }));

    const sortedTopSellers = [...topSellers].sort((a, b) => {
      let result = 0;
      switch (topSortKey) {
        case "modelName":
          result = a.modelName.localeCompare(b.modelName, undefined, { sensitivity: "base" });
          break;
        case "purchaseCount":
          result = a.purchaseCount - b.purchaseCount;
          break;
        case "creditsEarned":
          result = a.creditsEarned - b.creditsEarned;
          break;
      }
      return topSortDir === "asc" ? result : -result;
    });

    const recent = recentCreditPurchases.map((cp) => ({
      id: cp.id,
      amount: Number(cp.amount),
      credits: cp.credits,
      status: cp.status,
      method: cp.paymentMethod,
      createdAt: cp.createdAt.toISOString(),
    }));

    const sortedRecent = [...recent].sort((a, b) => {
      let result = 0;
      switch (recentSortKey) {
        case "createdAt":
          result = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "method":
          result = a.method.localeCompare(b.method, undefined, { sensitivity: "base" });
          break;
        case "amount":
          result = a.amount - b.amount;
          break;
        case "credits":
          result = a.credits - b.credits;
          break;
        case "status":
          result = a.status.localeCompare(b.status, undefined, { sensitivity: "base" });
          break;
      }
      return recentSortDir === "asc" ? result : -result;
    });

    return NextResponse.json({
      users: {
        total: totalUsers,
        new7d: newUsers7d,
        new30d: newUsers30d,
      },
      content: {
        totalModels,
        activeModels,
        totalContentItems,
      },
      credits: {
        totalIssued: totalCreditsIssued._sum.amount || 0,
        totalSpent: Math.abs(totalCreditsSpent._sum.amount || 0),
      },
      revenue: {
        total: Number(revenueTotal._sum.amount || 0),
        last30d: Number(revenue30d._sum.amount || 0),
        last7d: Number(revenue7d._sum.amount || 0),
      },
      creditPurchases: {
        byStatus: creditPurchasesByStatus.map((s) => ({
          status: s.status,
          count: s._count,
          amount: Number(s._sum.amount || 0),
        })),
        byMethod: creditPurchasesByMethod.map((m) => ({
          method: m.paymentMethod,
          count: m._count,
          amount: Number(m._sum.amount || 0),
        })),
        recent: sortedRecent,
      },
      purchases: {
        total: totalPurchases,
        bundles: bundlePurchases,
        individual: modelPurchases,
      },
      topSellers: sortedTopSellers,
    });
  } catch (error) {
    logger.error("Admin analytics error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
