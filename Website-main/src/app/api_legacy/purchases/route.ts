import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { invalidateAccessCache } from "@/lib/access";
import { Prisma } from "@prisma/client";

const purchaseSchema = z.object({
  modelId: z.string().nullable().optional(), // null = bundle
  accessDuration: z.enum(["SEVEN_DAYS", "THIRTY_DAYS"]).optional(), // required for individual model
});
const userIdSchema = z.string().cuid();

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { modelId, accessDuration } = purchaseSchema.parse(body);
    const parsedUserId = userIdSchema.safeParse(session.user.id);
    if (!parsedUserId.success) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = parsedUserId.data;

    const isBundle = !modelId;

    // Individual model requires accessDuration
    if (!isBundle && !accessDuration) {
      return NextResponse.json({ error: "Access duration is required" }, { status: 400 });
    }

    // Get cost from settings
    let creditCost = 0;
    if (isBundle) {
      const costSetting = await db.setting.findUnique({ where: { key: "bundle_credit_cost" } });
      creditCost = costSetting ? (costSetting.value as number) : 0;
    } else {
      const costKey = accessDuration === "SEVEN_DAYS" ? "model_credit_cost_7d" : "model_credit_cost_30d";
      const costSetting = await db.setting.findUnique({ where: { key: costKey } });
      creditCost = costSetting ? (costSetting.value as number) : 0;
    }

    if (creditCost <= 0) {
      return NextResponse.json({ error: "Pricing not configured" }, { status: 400 });
    }

    // Calculate expiration
    let expiresAt: Date | null = null;
    if (!isBundle && accessDuration) {
      const now = new Date();
      if (accessDuration === "SEVEN_DAYS") {
        expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      } else {
        expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      }
    }
    // Bundle: expiresAt stays null (lifetime)

    // Use transaction with row-level lock to prevent double-spend
    const result = await db.$transaction(async (tx) => {
      // Lock the user row with SELECT ... FOR UPDATE to prevent concurrent
      // transactions from reading stale balances (prevents double-spend).
      const [lockedUser] = await tx.$queryRaw<{ id: string; creditBalance: number }[]>(
        Prisma.sql`SELECT id, "creditBalance" FROM "User" WHERE id = ${userId} FOR UPDATE`
      );

      if (!lockedUser || lockedUser.creditBalance < creditCost) {
        throw new Error("Insufficient credits");
      }

      // Check existing access inside the transaction to prevent TOCTOU
      if (!isBundle && modelId) {
        const existingAccess = await tx.userAccess.findFirst({
          where: {
            userId,
            OR: [{ modelId }, { modelId: null }],
            AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
          },
        });
        if (existingAccess) {
          throw new Error("Already has access");
        }
      } else if (isBundle) {
        const existingBundle = await tx.userAccess.findFirst({
          where: {
            userId,
            modelId: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        });
        if (existingBundle) {
          throw new Error("Already has access");
        }
      }

      // Deduct credits
      await tx.user.update({
        where: { id: userId },
        data: { creditBalance: { decrement: creditCost } },
      });

      // Create purchase
      const purchase = await tx.purchase.create({
        data: {
          userId,
          modelId: isBundle ? null : modelId,
          purchaseType: isBundle ? "BUNDLE" : "INDIVIDUAL_MODEL",
          accessDuration: isBundle ? null : accessDuration,
          creditsSpent: creditCost,
        },
      });

      // Create credit transaction (spend)
      const durationLabel = accessDuration === "SEVEN_DAYS" ? "7 days" : "30 days";
      await tx.creditTransaction.create({
        data: {
          userId,
          type: "SPEND",
          amount: -creditCost,
          purchaseId: purchase.id,
          description: isBundle
            ? "Bundle purchase (all models, lifetime)"
            : `Model purchase (${durationLabel})`,
        },
      });

      // Grant access
      await tx.userAccess.create({
        data: {
          userId,
          modelId: isBundle ? null : modelId!,
          purchaseId: purchase.id,
          expiresAt,
        },
      });

      // Create notification
      await tx.notification.create({
        data: {
          userId: session.user.id,
          type: "PURCHASE_COMPLETE",
          title: isBundle ? "Bundle purchased!" : "Model unlocked!",
          message: isBundle
            ? "You now have lifetime access to all models and future content."
            : `You now have ${durationLabel} access to this model.`,
          metadata: { purchaseId: purchase.id, expiresAt: expiresAt?.toISOString() },
        },
      });

      return purchase;
    });

    invalidateAccessCache(userId);
    return NextResponse.json({ success: true, purchaseId: result.id });
  } catch (error) {
    if (error instanceof Error && error.message === "Insufficient credits") {
      return NextResponse.json({ error: "Insufficient credits" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Already has access") {
      return NextResponse.json({ error: "You already have active access to this content" }, { status: 400 });
    }
    logger.error("Purchase error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
