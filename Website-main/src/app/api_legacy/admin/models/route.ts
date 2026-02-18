import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { logger } from "@/lib/logger";

type SortDir = "asc" | "desc";
type SortKey = "name" | "folderName" | "countryName" | "contentCount" | "isActive" | "lastSyncedAt";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email, session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const sortBy = (searchParams.get("sortBy") || "name") as SortKey;
    const sortDir: SortDir = searchParams.get("sortDir") === "desc" ? "desc" : "asc";

    const orderBy =
      sortBy === "folderName"
        ? { folderName: sortDir }
        : sortBy === "countryName"
          ? { country: { name: sortDir } }
          : sortBy === "contentCount"
            ? { contentItems: { _count: sortDir } }
            : sortBy === "isActive"
              ? { isActive: sortDir }
              : sortBy === "lastSyncedAt"
                ? { lastSyncedAt: sortDir }
                : { name: sortDir };

    const models = await db.model.findMany({
      include: {
        country: { select: { name: true } },
        _count: { select: { contentItems: true } },
      },
      orderBy,
    });

    return NextResponse.json(
      models.map((m) => ({
        id: m.id,
        name: m.name,
        folderName: m.folderName,
        countryName: m.country?.name || null,
        contentCount: m._count.contentItems,
        isActive: m.isActive,
        lastSyncedAt: m.lastSyncedAt?.toISOString() || null,
      }))
    );
  } catch (error) {
    logger.error("Admin models error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/admin/models - toggle model visibility
const patchSchema = z.object({
  id: z.string().min(1).max(50),
  isActive: z.boolean(),
});

export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email, session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { id, isActive } = parsed.data;

    const model = await db.model.findUnique({ where: { id } });
    if (!model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }

    await db.model.update({
      where: { id },
      data: { isActive },
    });

    return NextResponse.json({ success: true, isActive });
  } catch (error) {
    logger.error("Admin model toggle error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
