import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { badRequest, internalError } from "@/lib/api-errors";

const querySchema = z.object({
  cursor: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  country: z.string().max(50).optional(),
  search: z.string().max(100).optional(),
});

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({
      cursor: searchParams.get("cursor") || undefined,
      limit: searchParams.get("limit") || undefined,
      country: searchParams.get("country") || undefined,
      search: searchParams.get("search") || undefined,
    });

    if (!parsed.success) {
      return badRequest("Invalid query parameters");
    }

    const { cursor, limit, country, search } = parsed.data;

    // Build where clause conditions
    const conditions: any[] = [];

    // Filter by country
    if (country) {
      conditions.push({ countryId: country });
    }

    // Filter by search (case-insensitive contains)
    if (search) {
      conditions.push({
        name: {
          contains: search,
          mode: "insensitive" as const,
        },
      });
    }

    // Cursor-based pagination: if cursor provided, find the model and filter by name/id
    if (cursor) {
      const cursorModel = await db.model.findUnique({
        where: { id: cursor },
        select: { name: true },
      });

      if (cursorModel) {
        // Filter: (name > cursorModel.name) OR (name = cursorModel.name AND id > cursor)
        conditions.push({
          OR: [
            { name: { gt: cursorModel.name } },
            { name: cursorModel.name, id: { gt: cursor } },
          ],
        });
      }
    }

    // Always filter active models
    conditions.push({ isActive: true });

    // Build final where clause
    const where = { AND: conditions };

    // Query limit + 1 to check if there's a next page
    const models = await db.model.findMany({
      where,
      include: {
        country: {
          select: {
            name: true,
            flagEmoji: true,
          },
        },
        _count: {
          select: {
            contentItems: {
              where: { isActive: true },
            },
          },
        },
        contentItems: {
          where: { isActive: true },
          take: 1,
          select: { id: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: limit + 1,
    });

    // Check if there's a next page
    const hasNextPage = models.length > limit;
    const modelsToReturn = hasNextPage ? models.slice(0, limit) : models;
    const nextCursor = hasNextPage ? modelsToReturn[modelsToReturn.length - 1].id : null;

    // Format response
    const formattedModels = modelsToReturn.map((m) => ({
      id: m.id,
      name: m.name,
      folderName: m.folderName,
      description: m.description,
      countryId: m.countryId,
      countryName: m.country?.name || null,
      countryFlag: m.country?.flagEmoji || null,
      contentCount: m._count.contentItems,
      isActive: m.isActive,
      firstContentItemId: m.contentItems[0]?.id || null,
    }));

    return NextResponse.json({
      models: formattedModels,
      nextCursor,
    });
  } catch (error) {
    return internalError("Models API error", error);
  }
}
