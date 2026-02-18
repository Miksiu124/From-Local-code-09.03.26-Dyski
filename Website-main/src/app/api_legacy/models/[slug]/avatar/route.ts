import { NextResponse } from "next/server";
import { getObject } from "@/lib/r2";
import { logger } from "@/lib/logger";

const SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Public avatar proxy for model profile images (Top Creators row, etc).
 * Uses the avatar image from R2: avatars/{folderName}_avatar.webp
 * No authentication or DB query required -- path is deterministic.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // Validate slug to prevent path traversal
    if (!slug || slug.length > 100 || !SLUG_PATTERN.test(slug)) {
      return new NextResponse(null, { status: 400 });
    }

    let r2Response;
    try {
      // Primary path: avatars/{folderName}_avatar.webp
      r2Response = await getObject(`avatars/${slug}_avatar.webp`);
    } catch {
      try {
        // Fallback path: files/avatars/{folderName}_avatar.webp
        r2Response = await getObject(`files/avatars/${slug}_avatar.webp`);
      } catch {
        return new NextResponse(null, { status: 404 });
      }
    }

    if (!r2Response?.Body) {
      return new NextResponse(null, { status: 404 });
    }

    const bodyArray = await r2Response.Body.transformToByteArray();

    return new NextResponse(Buffer.from(bodyArray), {
      headers: {
        "Content-Type": r2Response.ContentType || "image/webp",
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
        "CDN-Cache-Control": "public, max-age=604800",
      },
    });
  } catch (error) {
    logger.error("Model avatar error", error);
    return new NextResponse(null, { status: 500 });
  }
}
