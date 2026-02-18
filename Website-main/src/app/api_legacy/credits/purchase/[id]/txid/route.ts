import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { unauthorized, badRequest, notFound, internalError } from "@/lib/api-errors";

const txidSchema = z.object({
  txId: z.string().min(1, "TxID is required").max(256, "TxID is too long"),
});

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

    const parsed = txidSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0].message);
    }

    const { txId } = parsed.data;

    // Atomic: only update txId if the purchase is still PENDING and belongs to this user
    const updated = await db.creditPurchase.updateMany({
      where: {
        id,
        userId: session.user.id,
        status: "PENDING",
      },
      data: { txId: txId.trim() },
    });

    if (updated.count === 0) {
      return badRequest("Purchase not found or already processed");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return internalError("TxID submit error", error);
  }
}
