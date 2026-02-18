import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { forbidden, badRequest, internalError } from "@/lib/api-errors";

const rejectSchema = z.object({
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
      // Body is optional for reject
    }

    const parsed = rejectSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0].message);
    }

    const { notes } = parsed.data;

    // Atomic: status check + update inside a single transaction.
    // updateMany with status:"PENDING" filter prevents TOCTOU.
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.creditPurchase.updateMany({
        where: { id, status: "PENDING" },
        data: {
          status: "REJECTED",
          adminNotes: notes || null,
          adminVerifiedAt: new Date(),
          adminId: session.user.id,
        },
      });

      if (updated.count === 0) {
        return { success: false as const };
      }

      // Fetch to get userId for notification
      const purchase = await tx.creditPurchase.findUnique({
        where: { id },
        select: { userId: true, id: true },
      });

      if (purchase) {
        await tx.notification.create({
          data: {
            userId: purchase.userId,
            type: "PAYMENT_REJECTED",
            title: "Payment Rejected",
            message: notes
              ? `Your payment was rejected. Reason: ${notes}`
              : "Your payment was rejected. Please try again or contact support.",
            metadata: { creditPurchaseId: purchase.id },
          },
        });
      }

      return { success: true as const };
    });

    if (!result.success) {
      return badRequest("Purchase not found or already processed");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return internalError("Reject error", error);
  }
}
