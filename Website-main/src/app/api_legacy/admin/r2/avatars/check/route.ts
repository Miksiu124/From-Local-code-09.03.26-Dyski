import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { listObjects } from "@/lib/r2";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email, session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [models, avatarsRoot, avatarsFiles] = await Promise.all([
      db.model.findMany({
        select: { id: true, folderName: true, isActive: true },
        orderBy: { folderName: "asc" },
      }),
      listObjects("avatars/"),
      listObjects("files/avatars/"),
    ]);

    const rootSet = new Set(avatarsRoot.map((o) => o.key));
    const filesSet = new Set(avatarsFiles.map((o) => o.key));

    const missing: string[] = [];
    const inRoot: string[] = [];
    const inFiles: string[] = [];

    for (const model of models) {
      const fileName = `${model.folderName}_avatar.webp`;
      const rootKey = `avatars/${fileName}`;
      const filesKey = `files/avatars/${fileName}`;

      if (rootSet.has(rootKey)) {
        inRoot.push(model.folderName);
        continue;
      }
      if (filesSet.has(filesKey)) {
        inFiles.push(model.folderName);
        continue;
      }
      missing.push(model.folderName);
    }

    return NextResponse.json({
      totalModels: models.length,
      foundInRoot: inRoot.length,
      foundInFiles: inFiles.length,
      missingCount: missing.length,
      missing,
    });
  } catch (error) {
    logger.error("Avatar check error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
