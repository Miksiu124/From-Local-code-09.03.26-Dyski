import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { performR2Sync } from "@/lib/r2-auto-sync";
import { logger } from "@/lib/logger";

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email, session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await performR2Sync();

    return NextResponse.json({
      success: true,
      newModels: result.newModels,
      newContentItems: result.newContentItems,
      updatedContentItems: result.updatedContentItems,
      deactivatedContentItems: result.deactivatedContentItems,
      deactivatedModels: result.deactivatedModels,
      totalModels: result.totalModels,
    });
  } catch (error) {
    logger.error("R2 sync error", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
