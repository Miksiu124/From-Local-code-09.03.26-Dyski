import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { invalidateAccessCache } from "@/lib/access";
import { forbidden, badRequest, internalError } from "@/lib/api-errors";

const grantSchema = z.object({
  modelId: z.string().nullable(), // null = bundle
  durationDays: z.number().positive().optional(), // null = lifetime
});
const userIdSchema = z.string().cuid();

/**
 * Grant manual access to a user (admin action).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email, session.user.role)) {
      return forbidden();
    }

    const { id: rawUserId } = await params;
    const parsedUserId = userIdSchema.safeParse(rawUserId);
    if (!parsedUserId.success) {
      return badRequest("Invalid user ID");
    }
    const userId = parsedUserId.data;
    const body = await req.json();
    const { modelId, durationDays } = grantSchema.parse(body);

    let expiresAt: Date | null = null;
    if (durationDays) {
      expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    }

    await db.$transaction(async (tx) => {
      // Check user exists
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) throw new Error("USER_NOT_FOUND");

      // Check for existing active access to prevent duplicates
      const existingAccess = await tx.userAccess.findFirst({
        where: {
          userId,
          modelId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (existingAccess) throw new Error("ALREADY_HAS_ACCESS");

      const purchase = await tx.purchase.create({
        data: {
          userId,
          modelId,
          purchaseType: modelId ? "INDIVIDUAL_MODEL" : "BUNDLE",
          accessDuration: null, // admin-granted
          creditsSpent: 0,
        },
      });

      await tx.userAccess.create({
        data: {
          userId,
          modelId,
          purchaseId: purchase.id,
          expiresAt,
        },
      });
    });

    invalidateAccessCache(userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest(error.issues[0].message);
    }
    if (error instanceof Error && error.message === "USER_NOT_FOUND") {
      return badRequest("User not found");
    }
    if (error instanceof Error && error.message === "ALREADY_HAS_ACCESS") {
      return badRequest("User already has active access to this content");
    }
    return internalError("Grant access error", error);
  }
}

/**
 * Revoke access for a user (admin action).
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email, session.user.role)) {
      return forbidden();
    }

    const { id: rawUserId } = await params;
    const parsedUserId = userIdSchema.safeParse(rawUserId);
    if (!parsedUserId.success) {
      return badRequest("Invalid user ID");
    }
    const userId = parsedUserId.data;
    const { searchParams } = new URL(req.url);
    const accessId = searchParams.get("accessId");

    if (!accessId) {
      return badRequest("accessId is required");
    }

    // Revoke by setting expiresAt to now
    await db.userAccess.update({
      where: { id: accessId, userId },
      data: { expiresAt: new Date() },
    });

    invalidateAccessCache(userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return internalError("Revoke access error", error);
  }
}
