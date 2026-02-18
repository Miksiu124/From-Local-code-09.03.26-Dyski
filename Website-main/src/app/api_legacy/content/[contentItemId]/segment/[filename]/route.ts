import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getObject } from "@/lib/r2";
import { isSafeR2FolderPath } from "@/lib/path-guard";
import { logger } from "@/lib/logger";
import { canAccessModel } from "@/lib/access";

const SEGMENT_FILENAME_PATTERN = /^[A-Za-z0-9._-]+\.ts$/;

function isValidSegmentFilename(filename: string) {
  if (filename.length > 200) return false;
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) return false;
  return SEGMENT_FILENAME_PATTERN.test(filename);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ contentItemId: string; filename: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { contentItemId, filename } = await params;

    // Validate contentItemId format (cuid)
    if (!/^[a-z0-9]+$/i.test(contentItemId) || contentItemId.length > 50) {
      return new NextResponse("Invalid content item ID", { status: 400 });
    }

    if (!isValidSegmentFilename(filename)) {
      return new NextResponse("Invalid filename", { status: 400 });
    }

    const contentItem = await db.contentItem.findUnique({
      where: { id: contentItemId },
      include: { model: true },
    });

    if (!contentItem || !contentItem.hlsFolderPath) {
      return new NextResponse("Not found", { status: 404 });
    }

    // Validate hlsFolderPath to prevent path traversal
    if (!isSafeR2FolderPath(contentItem.hlsFolderPath)) {
      return new NextResponse("Invalid path", { status: 400 });
    }

    const canAccess = await canAccessModel(session.user.id, contentItem.modelId);
    if (!canAccess) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // Construct R2 path: {modelFolder}/{hlsFolderPath}{filename}
    const r2Key = `${contentItem.model.folderName}/${contentItem.hlsFolderPath}${filename}`;

    const r2Response = await getObject(r2Key);

    if (!r2Response.Body) {
      return new NextResponse("Not found", { status: 404 });
    }

    const bodyArray = await r2Response.Body.transformToByteArray();

    return new NextResponse(Buffer.from(bodyArray), {
      headers: {
        "Content-Type": "video/mp2t",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("Segment proxy error", error);
    return new NextResponse("Internal server error", { status: 500 });
  }
}
