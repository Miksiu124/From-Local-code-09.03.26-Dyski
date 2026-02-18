import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// POST /api/favorites - toggle favorite (add/remove)
const bodySchema = z.object({
  contentItemId: z.string().min(1).max(50),
});

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { contentItemId } = parsed.data;
    const userId = session.user.id;

    // Verify content item exists
    const contentItem = await db.contentItem.findUnique({
      where: { id: contentItemId, isActive: true },
      select: { id: true },
    });

    if (!contentItem) {
      return NextResponse.json({ error: "Content item not found" }, { status: 404 });
    }

    // Check if already favorited
    const existing = await db.favorite.findUnique({
      where: { userId_contentItemId: { userId, contentItemId } },
    });

    if (existing) {
      // Remove favorite
      await db.favorite.delete({
        where: { id: existing.id },
      });
      return NextResponse.json({ favorited: false });
    } else {
      // Add favorite
      await db.favorite.create({
        data: { userId, contentItemId },
      });
      return NextResponse.json({ favorited: true });
    }
  } catch (error) {
    logger.error("Favorites toggle error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/favorites - list user's favorites with pagination
const querySchema = z.object({
  cursor: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({
      cursor: searchParams.get("cursor") || undefined,
      limit: searchParams.get("limit") || undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
    }

    const { cursor, limit } = parsed.data;
    const userId = session.user.id;

    const where: Record<string, unknown> = { userId };

    if (cursor) {
      const cursorFav = await db.favorite.findUnique({
        where: { id: cursor },
        select: { createdAt: true },
      });
      if (cursorFav) {
        where.createdAt = { lt: cursorFav.createdAt };
      }
    }

    const favorites = await db.favorite.findMany({
      where,
      include: {
        contentItem: {
          select: {
            id: true,
            contentType: true,
            thumbnailPath: true,
            model: {
              select: {
                id: true,
                name: true,
                folderName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });

    const hasNextPage = favorites.length > limit;
    const items = hasNextPage ? favorites.slice(0, limit) : favorites;

    const totalCount = await db.favorite.count({ where: { userId } });

    const nextCursor =
      hasNextPage && items.length > 0
        ? items[items.length - 1].id
        : null;

    return NextResponse.json({
      items: items.map((f) => ({
        id: f.id,
        contentItemId: f.contentItem.id,
        contentType: f.contentItem.contentType,
        thumbnailPath: f.contentItem.thumbnailPath,
        modelName: f.contentItem.model.name,
        modelSlug: f.contentItem.model.folderName,
        createdAt: f.createdAt,
      })),
      nextCursor,
      totalCount,
    });
  } catch (error) {
    logger.error("Favorites list error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
