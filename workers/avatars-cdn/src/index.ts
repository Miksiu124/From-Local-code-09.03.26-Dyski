/**
 * Cloudflare Worker — publiczny odczyt z R2 (bucket FILES).
 * - avatars/* — avatary / headery
 * - pozostałe klucze — zdjęcia, HLS, segmenty (.m3u8, .ts, …) zgodnie z ścieżkami w R2
 *
 * Zablokowane: path traversal, proofs/ (dowody płatności mogą być w tym samym buckecie).
 */

const BLOCKED_PREFIXES = ["proofs/"];

function isPathAllowed(path: string): boolean {
  if (path === "" || path.includes("..") || path.includes("\\")) {
    return false;
  }
  const lower = path.toLowerCase();
  for (const p of BLOCKED_PREFIXES) {
    const noSlash = p.slice(0, -1);
    if (lower === noSlash || lower.startsWith(p)) {
      return false;
    }
  }
  return true;
}

/**
 * Cloudflare czasem przekazuje pathname z %20 / %28 itd.; klucz w R2 ma zwykle już znaki „ludzkie”.
 * Dekodujemy każdy segment osobno (nie cały string — unikamy nadużyć %2F).
 */
function pathnameToR2Key(pathname: string): string {
  let path = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  path = path
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
  return path;
}

function contentTypeFromKey(key: string): string | undefined {
  const lower = key.toLowerCase();
  if (lower.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (lower.endsWith(".ts")) return "video/mp2t";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".vtt")) return "text/vtt";
  return undefined;
}

function buildCors(): Headers {
  const h = new Headers();
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  h.set("Access-Control-Max-Age", "86400");
  return h;
}

/** HLS playlists change; keep edge/browser TTL short. */
const CACHE_M3U8 = "public, max-age=10, stale-while-revalidate=30";
/** Same path can be overwritten (avatar/header refresh). */
const CACHE_AVATAR_PREFIX = "public, max-age=2592000";
/** Versioned / unique object keys — safe for immutable + 1y (fewer R2 reads via CDN/browser). */
const CACHE_IMMUTABLE_YEAR =
  "public, max-age=31536000, immutable, stale-while-revalidate=86400";

function cacheControlForKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".m3u8")) {
    return CACHE_M3U8;
  }
  if (lower.startsWith("avatars/")) {
    return CACHE_AVATAR_PREFIX;
  }
  if (
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".ts") ||
    lower.endsWith(".mp4") ||
    lower.endsWith(".webm") ||
    lower.endsWith(".vtt")
  ) {
    return CACHE_IMMUTABLE_YEAR;
  }
  return "public, max-age=604800, stale-while-revalidate=86400";
}

function applyObjectHeaders(
  headers: Headers,
  key: string,
  metaType: string | undefined,
  etag: string | undefined,
  size: number | undefined,
  includeLength: boolean
): void {
  const guessed = contentTypeFromKey(key);
  if (metaType && metaType !== "application/octet-stream") {
    headers.set("Content-Type", metaType);
  } else if (guessed) {
    headers.set("Content-Type", guessed);
  } else if (metaType) {
    headers.set("Content-Type", metaType);
  } else {
    headers.set("Content-Type", "application/octet-stream");
  }
  headers.set("Cache-Control", cacheControlForKey(key));
  if (etag) headers.set("ETag", etag);
  if (includeLength && size !== undefined) {
    headers.set("Content-Length", String(size));
  }
}

interface Env {
  FILES: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: buildCors() });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const r2Key = pathnameToR2Key(url.pathname);

    if (!isPathAllowed(r2Key)) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      if (request.method === "HEAD") {
        const meta = await env.FILES.head(r2Key);
        if (!meta) {
          return new Response("Not Found", { status: 404 });
        }
        const headers = buildCors();
        applyObjectHeaders(
          headers,
          r2Key,
          meta.httpMetadata?.contentType,
          meta.httpEtag,
          meta.size,
          true
        );
        return new Response(null, { status: 200, headers });
      }

      const object = await env.FILES.get(r2Key);
      if (!object) {
        return new Response("Not Found", { status: 404 });
      }

      const headers = buildCors();
      applyObjectHeaders(
        headers,
        r2Key,
        object.httpMetadata?.contentType,
        object.httpEtag,
        object.size,
        false
      );

      return new Response(object.body, {
        status: 200,
        headers,
      });
    } catch (err) {
      console.error("[files-cdn] R2 error:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};
