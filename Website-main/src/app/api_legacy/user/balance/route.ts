import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { creditBalance: true },
    });

    return NextResponse.json({ creditBalance: user?.creditBalance || 0 });
  } catch (error) {
    logger.error("Balance error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
