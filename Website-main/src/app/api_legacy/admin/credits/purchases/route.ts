import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

type SortDir = "asc" | "desc";
type SortKey = "user" | "package" | "amount" | "method" | "code" | "status" | "date";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email, session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const sortBy = (searchParams.get("sortBy") || "date") as SortKey;
    const sortDir: SortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc";

    const orderBy =
      sortBy === "user"
        ? { user: { email: sortDir } }
        : sortBy === "package"
          ? { creditPackage: { name: sortDir } }
          : sortBy === "amount"
            ? { amount: sortDir }
            : sortBy === "method"
              ? { paymentMethod: sortDir }
              : sortBy === "status"
                ? { status: sortDir }
                : sortBy === "code"
                  ? { transactionCode: sortDir }
                  : { createdAt: sortDir };

    const now = new Date();
    await db.creditPurchase.updateMany({
      where: {
        status: "PENDING",
        paymentMethod: "BLIK",
        expirationTime: { lt: now },
      },
      data: { status: "EXPIRED" },
    });

    const purchases = await db.creditPurchase.findMany({
      include: {
        user: { select: { id: true, email: true, name: true } },
        creditPackage: { select: { name: true, credits: true, price: true } },
      },
      orderBy,
      take: 200,
    });

    return NextResponse.json({
      purchases: purchases.map((p) => ({
        id: p.id,
        userEmail: p.user.email,
        userName: p.user.name,
        packageName: p.creditPackage.name,
        credits: p.credits,
        amount: p.amount,
        paymentMethod: p.paymentMethod,
        transactionCode: p.transactionCode,
        // Mask sensitive fields in list view
        blikCode: p.blikCode ? `***${p.blikCode.slice(-3)}` : null,
        cryptoCurrency: p.cryptoCurrency,
        txId: p.txId ? `${p.txId.slice(0, 8)}...` : null,
        status: p.status,
        hasProof: !!p.paymentProofUrl,
        adminNotes: p.adminNotes ? "..." : null,
        expirationTime: p.expirationTime.toISOString(),
        createdAt: p.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error("Admin purchases list error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
