import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { forbidden, badRequest, notFound, internalError } from "@/lib/api-errors";

const approveSchema = z.object({
  notes: z.string().trim().max(1000).optional().default(""),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email, session.user.role)) {
      return forbidden();
    }

    const { id } = await params;

    let body = {};
    try {
      body = await req.json();
    } catch {
      // Body is optional for approve
    }

    const parsed = approveSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0].message);
    }

    const { notes } = parsed.data;

    // Everything inside one transaction to prevent race conditions.
    // Use updateMany with a status:"PENDING" filter so only the first
    // concurrent call actually flips the row — the second gets count:0.
    const result = await db.$transaction(async (tx) => {
      // Atomically claim the purchase: only succeeds if still PENDING,
      // not expired, and not owned by this admin (prevent self-approval).
      const updated = await tx.creditPurchase.updateMany({
        where: {
          id,
          status: "PENDING",
          expirationTime: { gt: new Date() },
          userId: { not: session.user.id },
        },
        data: {
          status: "APPROVED",
          adminNotes: notes || null,
          adminVerifiedAt: new Date(),
          adminId: session.user.id,
        },
      });

      if (updated.count === 0) {
        // Either not found, already processed, expired, or self-approval attempt
        return { success: false as const };
      }

      // Fetch the purchase details we need (now guaranteed APPROVED by us)
      const purchase = await tx.creditPurchase.findUnique({
        where: { id },
        include: { creditPackage: true },
      });

      if (!purchase || purchase.credits <= 0) {
        return { success: false as const };
      }

      // Add credits to user balance
      await tx.user.update({
        where: { id: purchase.userId },
        data: { creditBalance: { increment: purchase.credits } },
      });

      // Create credit transaction record
      await tx.creditTransaction.create({
        data: {
          userId: purchase.userId,
          type: "PURCHASE",
          amount: purchase.credits,
          creditPurchaseId: purchase.id,
          description: `Credit purchase approved: ${purchase.creditPackage.name} (${purchase.credits} credits)`,
        },
      });

      // Create notification
      await tx.notification.create({
        data: {
          userId: purchase.userId,
          type: "PAYMENT_APPROVED",
          title: "Payment Approved",
          message: `Your payment of ${purchase.credits} credits has been approved. Credits have been added to your balance.`,
          metadata: { creditPurchaseId: purchase.id, credits: purchase.credits },
        },
      });

      return { success: true as const };
    });

    if (!result.success) {
      return badRequest("Purchase not found, already processed, expired, or you cannot approve your own purchase");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return internalError("Approve error", error);
  }
}
