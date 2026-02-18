import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

type SortDir = "asc" | "desc";
type SortKey = "user" | "credits" | "purchases" | "access" | "joined";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email, session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const search = (searchParams.get("search") || "").slice(0, 100);
    const rawPage = Number(searchParams.get("page") || "1");
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
    const sortBy = (searchParams.get("sortBy") || "user") as SortKey;
    const sortDir: SortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc";
    const limit = 20;

    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" as const } },
            { name: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const orderBy =
      sortBy === "credits"
        ? { creditBalance: sortDir }
        : sortBy === "purchases"
          ? { _count: { purchases: sortDir } }
          : sortBy === "access"
            ? { _count: { userAccess: sortDir } }
            : sortBy === "joined"
              ? { createdAt: sortDir }
              : [{ name: sortDir }, { email: sortDir }];

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          creditBalance: true,
          createdAt: true,
          lastLoginAt: true,
          _count: {
            select: {
              purchases: true,
              creditPurchases: true,
              userAccess: true,
            },
          },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.user.count({ where }),
    ]);

    return NextResponse.json({
      users,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    logger.error("Admin users error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
