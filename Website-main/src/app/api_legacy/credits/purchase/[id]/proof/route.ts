import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { uploadProofFile } from "@/lib/r2-proof";
import { unauthorized, badRequest, notFound, internalError } from "@/lib/api-errors";

// ── Magic bytes for file type validation ─────────────────────────────────────

const SIGNATURES: { mime: string; bytes: number[]; offset?: number }[] = [
  { mime: "image/jpeg", bytes: [0xFF, 0xD8, 0xFF] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4E, 0x47] },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, // RIFF header; WEBP at offset 8
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
];

function detectMimeFromBytes(buffer: Buffer): string | null {
  for (const sig of SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (buffer.length < offset + sig.bytes.length) continue;
    const match = sig.bytes.every((b, i) => buffer[offset + i] === b);
    if (match) {
      // Extra check for WebP: bytes 8-11 must be "WEBP"
      if (sig.mime === "image/webp") {
        if (buffer.length >= 12 && buffer.toString("ascii", 8, 12) === "WEBP") {
          return sig.mime;
        }
        continue;
      }
      return sig.mime;
    }
  }
  return null;
}

// ── MIME -> extension map (server-controlled, never from client) ─────────────

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

const ALLOWED_MIMES = new Set(Object.keys(MIME_TO_EXT));
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const CUID_PATTERN = /^[a-z0-9]+$/i;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return unauthorized();
    }

    const { id } = await params;

    // Sanitize ID to prevent path injection
    if (!CUID_PATTERN.test(id)) {
      return badRequest("Invalid purchase ID");
    }

    // Verify ownership (read-only pre-check for fast fail)
    const purchase = await db.creditPurchase.findUnique({
      where: { id },
      select: { userId: true, status: true },
    });

    if (!purchase || purchase.userId !== session.user.id) {
      return notFound("Purchase not found");
    }

    if (purchase.status !== "PENDING") {
      return badRequest("Can only upload proof for pending purchases");
    }

    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return badRequest("No file provided");
    }

    if (file.size > MAX_SIZE_BYTES) {
      return badRequest("File too large. Maximum size is 10 MB");
    }

    // Read file into buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate content by magic bytes — not the client-supplied MIME type
    const detectedMime = detectMimeFromBytes(buffer);
    if (!detectedMime || !ALLOWED_MIMES.has(detectedMime)) {
      return badRequest("File content does not match an allowed type. Accepted: JPEG, PNG, WebP, GIF, PDF");
    }

    // Derive extension from detected MIME (never from client filename)
    const ext = MIME_TO_EXT[detectedMime];
    const key = `proofs/${id}/${Date.now()}.${ext}`;

    await uploadProofFile(key, buffer, detectedMime);

    // Atomic save: only succeeds if purchase is still PENDING and owned by user.
    // Prevents TOCTOU — status could have changed during the upload.
    const updated = await db.creditPurchase.updateMany({
      where: { id, userId: session.user.id, status: "PENDING" },
      data: { paymentProofUrl: key },
    });

    if (updated.count === 0) {
      return badRequest("Purchase was processed while uploading. Proof was not saved.");
    }

    return NextResponse.json({ success: true, proofUrl: key });
  } catch (error) {
    return internalError("Failed to upload payment proof", error);
  }
}
