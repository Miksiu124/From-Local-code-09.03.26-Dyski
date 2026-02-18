import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { unauthorized, badRequest, internalError } from "@/lib/api-errors";

const blikSchema = z.object({
  blikCode: z.string().min(6).max(6).regex(/^\d{6}$/, "BLIK code must be 6 digits"),
});

const BLIK_EXPIRATION_MINUTES = 2;
const MAX_RETRIES = 10;

/**
 * Update the BLIK code on an expired/pending BLIK purchase and reset its timer.
 * Uses atomic updateMany so the status can't change between check and write.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return unauthorized();
    }

    const { id } = await params;

    let body;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    const parsed = blikSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0].message);
    }

    const { blikCode } = parsed.data;

    // Check retry count first (read-only, non-critical)
    const existing = await db.creditPurchase.findFirst({
      where: { id, userId: session.user.id, paymentMethod: "BLIK" },
      select: { retryCount: true },
    });

    if (!existing) {
      return badRequest("BLIK purchase not found");
    }

    if (existing.retryCount >= MAX_RETRIES) {
      return badRequest("Too many retry attempts for this purchase");
    }

    const newExpiration = new Date(Date.now() + BLIK_EXPIRATION_MINUTES * 60 * 1000);

    // Atomic update: only succeeds if purchase is still PENDING or EXPIRED
    // and belongs to this user with BLIK payment method.
    const updated = await db.creditPurchase.updateMany({
      where: {
        id,
        userId: session.user.id,
        paymentMethod: "BLIK",
        status: { in: ["PENDING", "EXPIRED"] },
      },
      data: {
        blikCode: blikCode.trim(),
        expirationTime: newExpiration,
        status: "PENDING",
        retryCount: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      return badRequest("This purchase has already been processed or was not found");
    }

    return NextResponse.json({
      success: true,
      expirationTime: newExpiration.toISOString(),
    });
  } catch (error) {
    return internalError("BLIK code update error", error);
  }
}
