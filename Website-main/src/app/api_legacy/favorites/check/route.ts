import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// POST /api/favorites/check - batch check which content items are favorited
const bodySchema = z.object({
  contentItemIds: z.array(z.string().min(1).max(50)).min(1).max(200),
});

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ favorited: [] });
    }

    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { contentItemIds } = parsed.data;
    const userId = session.user.id;

    const favorites = await db.favorite.findMany({
      where: {
        userId,
        contentItemId: { in: contentItemIds },
      },
      select: { contentItemId: true },
    });

    return NextResponse.json({
      favorited: favorites.map((f) => f.contentItemId),
    });
  } catch (error) {
    logger.error("Favorites check error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
