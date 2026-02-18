import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { logger } from "@/lib/logger";

const settingItemSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.union([z.string(), z.number(), z.boolean()]),
  description: z.string().max(500).optional(),
});

const updateSettingsSchema = z.object({
  settings: z.array(settingItemSchema).min(1, "At least one setting is required").max(50),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email, session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await db.setting.findMany({
      orderBy: { key: "asc" },
    });

    return NextResponse.json(
      settings.map((s) => ({
        key: s.key,
        value: s.value,
        description: s.description,
      }))
    );
  } catch (error) {
    logger.error("Settings error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email, session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { settings } = parsed.data;

    for (const setting of settings) {
      await db.setting.upsert({
        where: { key: setting.key },
        update: { value: setting.value },
        create: {
          key: setting.key,
          value: setting.value,
          description: setting.description || null,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Settings update error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
