import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateTransactionCode } from "@/lib/utils";
import { unauthorized, badRequest, notFound, internalError, jsonError } from "@/lib/api-errors";

const createSchema = z.object({
  creditPackageId: z.string(),
  paymentMethod: z.enum(["BLIK", "CRYPTO", "PAYPAL", "REVOLUT"]),
  cryptoCurrency: z.enum(["BTC", "ETH", "USDT", "USDC"]).optional(),
  blikCode: z.string().optional(), // User provides their own BLIK code
});

const BLIK_EXPIRATION_MINUTES = 2;

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return unauthorized();
    }

    const body = await req.json();
    const { creditPackageId, paymentMethod, cryptoCurrency, blikCode } = createSchema.parse(body);

    // BLIK requires user-provided code
    if (paymentMethod === "BLIK" && (!blikCode || blikCode.trim().length < 6)) {
      return badRequest("BLIK code is required (6 digits)");
    }

    // Get credit package (can be done outside transaction — immutable data)
    const creditPackage = await db.creditPackage.findUnique({
      where: { id: creditPackageId, isActive: true },
    });

    if (!creditPackage) {
      return notFound("Package not found or inactive");
    }

    // Calculate expiration
    let expirationTime: Date;
    const now = new Date();

    if (paymentMethod === "BLIK") {
      expirationTime = new Date(now.getTime() + BLIK_EXPIRATION_MINUTES * 60 * 1000);
    } else if (paymentMethod === "CRYPTO") {
      const cryptoHoursSetting = await db.setting.findUnique({ where: { key: "crypto_expiration_hours" } });
      const hours = cryptoHoursSetting ? (cryptoHoursSetting.value as number) : 48;
      expirationTime = new Date(now.getTime() + hours * 60 * 60 * 1000);
    } else if (paymentMethod === "PAYPAL") {
      const paypalHoursSetting = await db.setting.findUnique({ where: { key: "paypal_expiration_hours" } });
      const hours = paypalHoursSetting ? (paypalHoursSetting.value as number) : 1;
      expirationTime = new Date(now.getTime() + hours * 60 * 60 * 1000);
    } else {
      // REVOLUT
      const revolutHoursSetting = await db.setting.findUnique({ where: { key: "revolut_expiration_hours" } });
      const hours = revolutHoursSetting ? (revolutHoursSetting.value as number) : 1;
      expirationTime = new Date(now.getTime() + hours * 60 * 60 * 1000);
    }

    const transactionCode = generateTransactionCode();

    // Get crypto wallet if needed
    let walletAddress: string | null = null;
    if (paymentMethod === "CRYPTO" && cryptoCurrency) {
      const walletsSetting = await db.setting.findUnique({ where: { key: "crypto_wallets" } });
      if (walletsSetting) {
        const wallets = walletsSetting.value as Record<string, string>;
        walletAddress = wallets[cryptoCurrency] || null;
      }
    }

    // Anti-spam check + creation inside a transaction so the count
    // and the insert are atomic — no race between concurrent requests.
    const maxPendingSetting = await db.setting.findUnique({
      where: { key: "max_pending_credit_purchases" },
    });
    const maxPending = maxPendingSetting ? (maxPendingSetting.value as number) : 3;

    const creditPurchase = await db.$transaction(async (tx) => {
      const pendingCount = await tx.creditPurchase.count({
        where: { userId: session.user.id, status: "PENDING" },
      });

      if (pendingCount >= maxPending) {
        throw new Error("RATE_LIMITED");
      }

      return tx.creditPurchase.create({
        data: {
          userId: session.user.id,
          creditPackageId: creditPackage.id,
          credits: creditPackage.credits,
          amount: creditPackage.price,
          paymentMethod,
          transactionCode,
          blikCode: paymentMethod === "BLIK" ? blikCode!.trim() : null,
          cryptoCurrency: paymentMethod === "CRYPTO" ? cryptoCurrency : null,
          expirationTime,
          status: "PENDING",
        },
      });
    });

    return NextResponse.json({
      id: creditPurchase.id,
      transactionCode,
      blikCode: creditPurchase.blikCode,
      walletAddress,
      cryptoCurrency,
      amount: creditPackage.price,
      credits: creditPackage.credits,
      expirationTime: expirationTime.toISOString(),
      paymentMethod,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest(error.issues[0].message);
    }
    if (error instanceof Error && error.message === "RATE_LIMITED") {
      return jsonError("RATE_LIMITED", "You already have too many pending purchases. Please wait for them to be processed.");
    }
    return internalError("Credit purchase error", error);
  }
}

// Get user's credit purchases
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return unauthorized();
    }

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status");
    const VALID_STATUSES = ["PENDING", "APPROVED", "REJECTED", "EXPIRED"] as const;
    const status = statusParam && VALID_STATUSES.includes(statusParam as typeof VALID_STATUSES[number])
      ? (statusParam as typeof VALID_STATUSES[number])
      : null;

    const now = new Date();
    await db.creditPurchase.updateMany({
      where: {
        userId: session.user.id,
        status: "PENDING",
        expirationTime: { lt: now },
      },
      data: { status: "EXPIRED" },
    });

    const purchases = await db.creditPurchase.findMany({
      where: {
        userId: session.user.id,
        ...(status ? { status } : {}),
      },
      include: {
        creditPackage: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json(purchases);
  } catch (error) {
    return internalError("Get credit purchases error", error);
  }
}
