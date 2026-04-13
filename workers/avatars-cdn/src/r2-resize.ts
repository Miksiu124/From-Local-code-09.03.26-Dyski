/**
 * Optional edge image resize via Cloudflare Image Resizing (cf.image on fetch subrequest).
 * Source: signed GET to R2 S3 API — requires R2_* secrets on the Worker (see README).
 */
import { AwsClient } from "aws4fetch";

export interface ResizeParams {
  w?: number;
  h?: number;
  fit: "scale-down" | "contain" | "cover" | "crop" | "pad";
  q: number;
  format: "auto" | "webp" | "avif" | "jpeg" | "json";
  anim: boolean;
}

const MAX_DIM = 4096;
const FIT_SET = new Set(["scale-down", "contain", "cover", "crop", "pad"]);
const FORMAT_SET = new Set(["auto", "webp", "avif", "jpeg", "json"]);

function boundDim(s: string | null): number | undefined {
  if (!s) return undefined;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1 || n > MAX_DIM) return undefined;
  return n;
}

export function parseResizeParams(url: URL): ResizeParams | null {
  const w = boundDim(url.searchParams.get("w"));
  const h = boundDim(url.searchParams.get("h"));
  if (w === undefined && h === undefined) return null;

  const fitRaw = url.searchParams.get("fit") || "scale-down";
  const fit = (FIT_SET.has(fitRaw) ? fitRaw : "scale-down") as ResizeParams["fit"];

  const qRaw = url.searchParams.get("q");
  let q = 85;
  if (qRaw) {
    const n = parseInt(qRaw, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 100) q = n;
  }

  const formatRaw = url.searchParams.get("format") || "auto";
  const format = (FORMAT_SET.has(formatRaw) ? formatRaw : "auto") as ResizeParams["format"];

  const animStr = url.searchParams.get("anim");
  const anim = animStr !== "false" && animStr !== "0";

  return { w, h, fit, q, format, anim };
}

export function buildR2HttpUrl(accountId: string, bucket: string, key: string): string {
  const path = key
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${path}`;
}

export function isImageResizeKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".avif")
  );
}

export interface ResizeEnv {
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  IMAGE_RESIZE_DISABLED?: string;
}

export function hasResizeConfig(env: ResizeEnv): boolean {
  return !!(
    env.R2_ACCOUNT_ID?.trim() &&
    env.R2_ACCESS_KEY_ID?.trim() &&
    env.R2_SECRET_ACCESS_KEY?.trim()
  );
}

export function isResizeDisabled(env: ResizeEnv): boolean {
  return env.IMAGE_RESIZE_DISABLED === "1" || env.IMAGE_RESIZE_DISABLED === "true";
}

export type TransformResult =
  | { ok: true; response: Response }
  | { ok: false; reason: string };

/**
 * Fetch from R2 via S3 API + Cloudflare Image Resizing (cf.image).
 */
export async function fetchTransformedFromR2(
  env: ResizeEnv,
  r2Key: string,
  params: ResizeParams
): Promise<TransformResult> {
  const accountId = env.R2_ACCOUNT_ID!.trim();
  const bucket = (env.R2_BUCKET_NAME || "files").trim();
  const url = buildR2HttpUrl(accountId, bucket, r2Key);

  const aws = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(),
    service: "s3",
    region: "auto",
  });

  let signed: Request;
  try {
    /** Presigned query (not Authorization header) — cf.image subrequests can break SigV4 header signing → upstream-400/403. */
    signed = await aws.sign(new Request(url, { method: "GET" }), {
      aws: { signQuery: true },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[files-cdn] aws sign error:", msg);
    return { ok: false, reason: `sign:${msg.slice(0, 80)}` };
  }

  /** `auto` often keeps bytes nearly unchanged when dims match; webp forces a real encode. */
  const outFormat = params.format === "auto" ? "webp" : params.format;

  let res: Response;
  try {
    res = await fetch(signed, {
      cf: {
        image: {
          ...(params.w !== undefined ? { width: params.w } : {}),
          ...(params.h !== undefined ? { height: params.h } : {}),
          fit: params.fit,
          quality: params.q,
          format: outFormat,
          anim: params.anim,
        },
      },
    } as RequestInit);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[files-cdn] cf.image fetch error:", msg);
    return { ok: false, reason: `fetch:${msg.slice(0, 80)}` };
  }

  if (!res.ok) {
    console.error(
      "[files-cdn] cf.image upstream R2 fetch not ok:",
      res.status,
      res.statusText
    );
    return { ok: false, reason: `upstream-${res.status}` };
  }

  const ct = (res.headers.get("Content-Type") || "").toLowerCase();
  const expectJson = params.format === "json";
  const looksImage = ct.startsWith("image/");
  const looksJson = ct.includes("json");
  if (expectJson && !looksJson) {
    console.error("[files-cdn] cf.image expected json, got:", ct);
    return { ok: false, reason: `bad-ct-json` };
  }
  if (!expectJson && !looksImage) {
    console.error(
      "[files-cdn] cf.image expected image/*, got:",
      ct,
      "(S3/XML error body?)"
    );
    return { ok: false, reason: `bad-ct:${ct.slice(0, 40)}` };
  }

  return { ok: true, response: res };
}
