import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { logger } from "@/lib/logger";

const createPackageSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  credits: z.number().int().positive("Credits must be positive"),
  price: z.number().positive("Price must be positive"),
  tier: z.number().int().min(0, "Tier must be non-negative"),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email, session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const packages = await db.creditPackage.findMany({
      orderBy: { tier: "asc" },
    });

    return NextResponse.json(packages);
  } catch (error) {
    logger.error("Packages error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
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

    const parsed = createPackageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { name, credits, price, tier } = parsed.data;

    const pkg = await db.creditPackage.create({
      data: {
        name,
        credits,
        price,
        tier,
        isActive: true,
      },
    });

    return NextResponse.json(pkg, { status: 201 });
  } catch (error) {
    logger.error("Create package error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
