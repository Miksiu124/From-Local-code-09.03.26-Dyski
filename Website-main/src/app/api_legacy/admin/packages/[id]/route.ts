import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { logger } from "@/lib/logger";

const updatePackageSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  credits: z.number().int().positive().optional(),
  price: z.number().positive().optional(),
  tier: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email, session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = updatePackageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const data = parsed.data;

    const pkg = await db.creditPackage.update({
      where: { id },
      data: {
        name: data.name,
        credits: data.credits,
        price: data.price,
        tier: data.tier,
        isActive: data.isActive,
      },
    });

    return NextResponse.json(pkg);
  } catch (error) {
    logger.error("Update package error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
