import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const querySchema = z.object({
  cursor: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  type: z.enum(["VIDEO", "PHOTO"]).optional(),
  sort: z.enum(["newest", "oldest"]).default("newest"),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const { searchParams } = new URL(req.url);

    const parsed = querySchema.safeParse({
      cursor: searchParams.get("cursor") || undefined,
      limit: searchParams.get("limit") || undefined,
      type: searchParams.get("type") || undefined,
      sort: searchParams.get("sort") || undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
    }

    const { cursor, limit, type, sort } = parsed.data;
    const sortDirection = sort === "oldest" ? "asc" as const : "desc" as const;

    // Find model by folderName (slug)
    const model = await db.model.findUnique({
      where: { folderName: slug, isActive: true },
      select: { id: true },
    });

    if (!model) {
      return NextResponse.json({ error: "Model not found or inactive" }, { status: 404 });
    }

    // Build where clause for cursor-based pagination
    const where: Record<string, unknown> = {
      modelId: model.id,
      isActive: true,
    };

    // Filter by content type if specified
    if (type) {
      where.contentType = type;
    }

    if (cursor) {
      const cursorItem = await db.contentItem.findUnique({
        where: { id: cursor },
        select: { createdAt: true },
      });

      if (cursorItem) {
        where.createdAt = sortDirection === "desc"
          ? { lt: cursorItem.createdAt }
          : { gt: cursorItem.createdAt };
      }
    }

    const items = await db.contentItem.findMany({
      where,
      select: {
        id: true,
        contentType: true,
        thumbnailPath: true,
        duration: true,
      },
      orderBy: { createdAt: sortDirection },
      take: limit + 1,
    });

    const hasNextPage = items.length > limit;
    const itemsToReturn = hasNextPage ? items.slice(0, limit) : items;

    const totalCount = await db.contentItem.count({
      where: { modelId: model.id, isActive: true, ...(type ? { contentType: type } : {}) },
    });

    const nextCursor =
      hasNextPage && itemsToReturn.length > 0
        ? itemsToReturn[itemsToReturn.length - 1].id
        : null;

    return NextResponse.json({
      items: itemsToReturn,
      nextCursor,
      totalCount,
    });
  } catch (error) {
    logger.error("Content items API error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
