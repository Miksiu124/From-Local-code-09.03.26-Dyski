import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getObject } from "@/lib/r2";
import { logger } from "@/lib/logger";

/** Map file extensions to MIME types. */
function getContentType(path: string): string {
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/webp";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ contentItemId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { contentItemId } = await params;

    const contentItem = await db.contentItem.findUnique({
      where: { id: contentItemId },
      include: { model: true },
    });

    if (!contentItem || !contentItem.thumbnailPath) {
      return new NextResponse("Not found", { status: 404 });
    }

    // Validate thumbnailPath to prevent path traversal
    if (contentItem.thumbnailPath.includes("..") || contentItem.thumbnailPath.includes("\\")) {
      return new NextResponse("Invalid path", { status: 400 });
    }

    // Check access
    const access = await db.userAccess.findFirst({
      where: {
        userId: session.user.id,
        OR: [
          { modelId: contentItem.modelId },
          { modelId: null },
        ],
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        ],
      },
    });

    if (!access) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // Construct R2 path: {modelFolder}/{thumbnailPath}
    const r2Key = `${contentItem.model.folderName}/${contentItem.thumbnailPath}`;

    let r2Response;
    try {
      r2Response = await getObject(r2Key);
    } catch {
      // NoSuchKey or other R2 error
      return new NextResponse(null, { status: 404 });
    }

    if (!r2Response.Body) {
      return new NextResponse(null, { status: 404 });
    }

    const bodyArray = await r2Response.Body.transformToByteArray();

    return new NextResponse(Buffer.from(bodyArray), {
      headers: {
        "Content-Type": r2Response.ContentType || getContentType(contentItem.thumbnailPath),
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("Thumbnail proxy error", error);
    return new NextResponse(null, { status: 500 });
  }
}
