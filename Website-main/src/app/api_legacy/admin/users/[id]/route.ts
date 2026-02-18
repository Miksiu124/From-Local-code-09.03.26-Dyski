import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email, session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        creditBalance: true,
        createdAt: true,
        lastLoginAt: true,
        purchases: {
          include: { model: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        creditPurchases: {
          include: { creditPackage: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        userAccess: {
          include: { model: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: 50,
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    logger.error("Admin user detail error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
