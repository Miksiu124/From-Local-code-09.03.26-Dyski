import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { unauthorized, notFound, internalError } from "@/lib/api-errors";

/**
 * Lightweight endpoint to check the status of a credit purchase.
 * Used for polling from the payment waiting screen.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return unauthorized();
    }

    const { id } = await params;

    const purchase = await db.creditPurchase.findFirst({
      where: { id, userId: session.user.id },
      select: { status: true, credits: true, expirationTime: true },
    });

    if (!purchase) {
      return notFound();
    }

    // If still PENDING but past expiration, mark as EXPIRED
    if (purchase.status === "PENDING" && purchase.expirationTime < new Date()) {
      await db.creditPurchase.update({
        where: { id },
        data: { status: "EXPIRED" },
      });

      return NextResponse.json({
        status: "EXPIRED",
        credits: purchase.credits,
      });
    }

    return NextResponse.json({
      status: purchase.status,
      credits: purchase.credits,
    });
  } catch (error) {
    return internalError("Status check error", error);
  }
}
