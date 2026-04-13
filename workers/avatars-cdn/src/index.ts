import {
  fetchTransformedFromR2,
  hasResizeConfig,
  isImageResizeKey,
  isResizeDisabled,
  parseResizeParams,
} from "./r2-resize";

/**
 * Cloudflare Worker — R2 FILES bucket.
 * - avatars/* — public (no HMAC)
 * - Other objects — HMAC gatekeeper ?token=&expires= (aligned with Go thumbnailpub.SignMediaURLToken)
 * - HLS: after valid query token, sets HttpOnly session cookie so .ts can be fetched without query (see cookie scope)
 *
 * Secrets (wrangler): MEDIA_CDN_SIGNING_SECRET — must match backend STREAMING_TOKEN_SECRET or MEDIA_CDN_SIGNING_SECRET.
 * Vars: MEDIA_CDN_ALLOWED_ORIGINS=comma list (e.g. https://dyskiof.net,https://www.dyskiof.net). Empty = *.
 * MEDIA_GATEKEEPER_DISABLED=1 — bypass auth (migration / local only).
 */

const BLOCKED_PREFIXES = ["proofs/"];

const COOKIE_NAME = "cv_media_sess";

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

function isPublicAvatarPath(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === "avatars" || lower.startsWith("avatars/");
}

function isHlsCookiePath(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.endsWith(".ts") ||
    lower.endsWith(".m4s") ||
    lower.endsWith(".m3u8")
  );
}

function parentPrefix(key: string): string {
  const i = key.lastIndexOf("/");
  if (i <= 0) return "";
  return key.slice(0, i);
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

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function corsOrigin(request: Request, allowed: string[]): string {
  const reqOrigin = request.headers.get("Origin");
  if (allowed.length === 0) return "*";
  if (reqOrigin && allowed.includes(reqOrigin)) return reqOrigin;
  return allowed[0] ?? "*";
}

function buildCors(origin: string): Headers {
  const h = new Headers();
  h.set("Access-Control-Allow-Origin", origin);
  if (origin !== "*") {
    h.set("Access-Control-Allow-Credentials", "true");
  }
  h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  h.set("Access-Control-Max-Age", "86400");
  return h;
}

/** DevTools: Response Headers — `off` = public read (no secret or MEDIA_GATEKEEPER_DISABLED). */
function stampGatekeeper(headers: Headers, gatekeeperOff: boolean): void {
  headers.set("X-CV-Gatekeeper", gatekeeperOff ? "off" : "on");
}

const CACHE_M3U8 = "public, max-age=10, stale-while-revalidate=30";
const CACHE_AVATAR_PREFIX = "public, max-age=2592000";
const CACHE_IMMUTABLE_YEAR =
  "public, max-age=31536000, immutable, stale-while-revalidate=86400";
/** Short TTL for signed query URLs (aligns with typical MEDIA_CDN_URL_TTL_SEC). */
const CACHE_SIGNED_MEDIA = "public, max-age=1800, stale-while-revalidate=60";

function cacheControlForKey(key: string, gatekeeperActive: boolean): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".m3u8")) {
    return CACHE_M3U8;
  }
  if (lower.startsWith("avatars/")) {
    return CACHE_AVATAR_PREFIX;
  }
  if (gatekeeperActive) {
    if (
      lower.endsWith(".ts") ||
      lower.endsWith(".m4s") ||
      lower.endsWith(".mp4") ||
      lower.endsWith(".webm") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".png") ||
      lower.endsWith(".webp") ||
      lower.endsWith(".gif") ||
      lower.endsWith(".vtt")
    ) {
      return CACHE_SIGNED_MEDIA;
    }
  } else if (
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
  includeLength: boolean,
  gatekeeperActive: boolean
): void {
  const guessed = contentTypeFromKey(key);
  const lower = key.toLowerCase();
  // R2 often stores video/vnd.dlna.mpeg-tts for .ts — prefer standard HLS MIME for players + CORS clients.
  const forceGuessedForHls =
    guessed &&
    (lower.endsWith(".ts") ||
      lower.endsWith(".m4s") ||
      lower.endsWith(".m3u8"));
  if (forceGuessedForHls) {
    headers.set("Content-Type", guessed);
  } else if (metaType && metaType !== "application/octet-stream") {
    headers.set("Content-Type", metaType);
  } else if (guessed) {
    headers.set("Content-Type", guessed);
  } else if (metaType) {
    headers.set("Content-Type", metaType);
  } else {
    headers.set("Content-Type", "application/octet-stream");
  }
  headers.set("Cache-Control", cacheControlForKey(key, gatekeeperActive));
  if (etag) headers.set("ETag", etag);
  if (includeLength && size !== undefined) {
    headers.set("Content-Length", String(size));
  }
}

function hexFromBuffer(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return hexFromBuffer(sig);
}

function signingBody(r2Key: string, exp: number): string {
  return r2Key + "\n" + String(exp);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

async function verifyQueryToken(
  secret: string,
  r2Key: string,
  token: string | null,
  expStr: string | null
): Promise<boolean> {
  if (!token || !expStr || token.length !== 64) return false;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp <= 0) return false;
  if (Math.floor(Date.now() / 1000) > exp) return false;
  const expected = await hmacHex(secret, signingBody(r2Key, exp));
  return timingSafeEqualHex(expected, token.toLowerCase());
}

function sessionSignBody(prefix: string, exp: number): string {
  return "session:" + prefix + "\n" + String(exp);
}

function b64urlEncode(s: string): string {
  const b = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function buildSessionCookieValue(
  secret: string,
  prefix: string,
  exp: number
): Promise<string> {
  const sig = await hmacHex(secret, sessionSignBody(prefix, exp));
  return `v1.${exp}.${b64urlEncode(prefix)}.${sig}`;
}

function getCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const parts = header.split(";");
  for (const p of parts) {
    const [k, ...rest] = p.trim().split("=");
    if (k === name) return rest.join("=").trim();
  }
  return null;
}

async function verifySessionCookie(
  secret: string,
  r2Key: string,
  cookieHeader: string | null
): Promise<boolean> {
  const raw = getCookie(cookieHeader, COOKIE_NAME);
  if (!raw) return false;
  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const exp = parseInt(parts[1]!, 10);
  if (!Number.isFinite(exp) || exp <= 0) return false;
  if (Math.floor(Date.now() / 1000) > exp) return false;
  let prefix: string;
  try {
    prefix = b64urlDecode(parts[2]!);
  } catch {
    return false;
  }
  if (!prefix || prefix.includes("..")) return false;
  const sig = parts[3]!;
  if (sig.length !== 64) return false;
  const expected = await hmacHex(secret, sessionSignBody(prefix, exp));
  if (!timingSafeEqualHex(expected, sig.toLowerCase())) return false;
  if (r2Key === prefix) return true;
  if (r2Key.startsWith(prefix + "/")) return true;
  return false;
}

interface Env {
  FILES: R2Bucket;
  MEDIA_CDN_SIGNING_SECRET?: string;
  MEDIA_CDN_ALLOWED_ORIGINS?: string;
  MEDIA_GATEKEEPER_DISABLED?: string;
  /** R2 S3 API (same bucket as FILES) — used only for optional ?w=&h= image resize via cf.image */
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  IMAGE_RESIZE_DISABLED?: string;
}

function computeGatekeeperState(env: Env): { secret: string; gatekeeperOff: boolean } {
  const secret = (env.MEDIA_CDN_SIGNING_SECRET || "").trim();
  const gatekeeperOff =
    env.MEDIA_GATEKEEPER_DISABLED === "1" ||
    env.MEDIA_GATEKEEPER_DISABLED === "true" ||
    !secret;
  return { secret, gatekeeperOff };
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const allowed = parseAllowedOrigins(env.MEDIA_CDN_ALLOWED_ORIGINS);
    const origin = corsOrigin(request, allowed);
    const { secret, gatekeeperOff } = computeGatekeeperState(env);

    if (request.method === "OPTIONS") {
      const oh = buildCors(origin);
      stampGatekeeper(oh, gatekeeperOff);
      return new Response(null, { status: 204, headers: oh });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const r2Key = pathnameToR2Key(url.pathname);

    if (!isPathAllowed(r2Key)) {
      const bh = buildCors(origin);
      stampGatekeeper(bh, gatekeeperOff);
      return new Response("Forbidden", { status: 403, headers: bh });
    }

    const needAuth =
      !gatekeeperOff && !isPublicAvatarPath(r2Key);

    let authorized = !needAuth;
    let setSessionCookie: string | null = null;

    if (needAuth) {
      const token = url.searchParams.get("token");
      const expiresQ = url.searchParams.get("expires");
      if (token && expiresQ && (await verifyQueryToken(secret, r2Key, token, expiresQ))) {
        authorized = true;
        if (isHlsCookiePath(r2Key)) {
          const exp = parseInt(expiresQ, 10);
          const prefix = parentPrefix(r2Key);
          if (prefix) {
            const maxAge = Math.max(0, exp - Math.floor(Date.now() / 1000));
            const val = await buildSessionCookieValue(secret, prefix, exp);
            setSessionCookie = `${COOKIE_NAME}=${val}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`;
          }
        }
      } else if (
        await verifySessionCookie(secret, r2Key, request.headers.get("Cookie"))
      ) {
        authorized = true;
      }
    }

    if (!authorized) {
      const fh = buildCors(origin);
      stampGatekeeper(fh, gatekeeperOff);
      return new Response("Forbidden", { status: 403, headers: fh });
    }

    const resizeParams = parseResizeParams(url);
    const gatekeeperActive = needAuth;
    const resizeEligible =
      request.method === "GET" &&
      resizeParams != null &&
      hasResizeConfig(env) &&
      !isResizeDisabled(env) &&
      isImageResizeKey(r2Key);

    let resizeFallbackToBinding = false;
    let resizeFallbackReason: string | undefined;
    if (resizeEligible) {
      try {
        const t = await fetchTransformedFromR2(env, r2Key, resizeParams);
        if (t.ok) {
          const transformed = t.response;
          const headers = buildCors(origin);
          const ct = transformed.headers.get("Content-Type");
          if (ct) {
            headers.set("Content-Type", ct);
          } else {
            const guessed = contentTypeFromKey(r2Key);
            if (guessed) headers.set("Content-Type", guessed);
            else headers.set("Content-Type", "application/octet-stream");
          }
          headers.set("Cache-Control", cacheControlForKey(r2Key, gatekeeperActive));
          headers.set("X-CV-Resize", "applied");
          if (resizeParams.w !== undefined) {
            headers.set("X-CV-Resize-W", String(resizeParams.w));
          }
          if (resizeParams.h !== undefined) {
            headers.set("X-CV-Resize-H", String(resizeParams.h));
          }
          stampGatekeeper(headers, gatekeeperOff);
          if (setSessionCookie) headers.append("Set-Cookie", setSessionCookie);
          const out = new Response(transformed.body, { status: 200, headers });
          const cache = caches.default;
          const useEdgeCacheSigned =
            needAuth && url.searchParams.has("token") && url.searchParams.has("expires");
          const cachePublicResize = !needAuth;
          if (useEdgeCacheSigned || cachePublicResize) {
            ctx.waitUntil(cache.put(request, out.clone()));
          }
          return out;
        }
        resizeFallbackReason = t.reason;
        resizeFallbackToBinding = true;
        console.error("[files-cdn] transform failed:", t.reason);
      } catch (e) {
        console.error("[files-cdn] resize error:", e);
        resizeFallbackReason =
          e instanceof Error ? e.message.slice(0, 100) : "exception";
        resizeFallbackToBinding = true;
      }
      // Fall through to R2 binding (full object)
    }

    const useEdgeCache =
      needAuth && url.searchParams.has("token") && url.searchParams.has("expires");

    try {
      const cache = caches.default;
      if (useEdgeCache) {
        const cached = await cache.match(request);
        if (cached) {
          const h = new Headers(cached.headers);
          mergeCors(h, origin);
          stampGatekeeper(h, gatekeeperOff);
          if (setSessionCookie) h.append("Set-Cookie", setSessionCookie);
          return new Response(cached.body, { status: cached.status, headers: h });
        }
      }

      if (request.method === "HEAD") {
        const resizeHeadEligible =
          resizeParams != null &&
          hasResizeConfig(env) &&
          !isResizeDisabled(env) &&
          isImageResizeKey(r2Key);

        if (resizeHeadEligible) {
          try {
            const t = await fetchTransformedFromR2(env, r2Key, resizeParams);
            if (t.ok) {
              const transformed = t.response;
              const headers = buildCors(origin);
              const ct = transformed.headers.get("Content-Type");
              if (ct) {
                headers.set("Content-Type", ct);
              } else {
                const guessed = contentTypeFromKey(r2Key);
                if (guessed) headers.set("Content-Type", guessed);
                else headers.set("Content-Type", "application/octet-stream");
              }
              headers.set("Cache-Control", cacheControlForKey(r2Key, gatekeeperActive));
              headers.set("X-CV-Resize", "applied");
              if (resizeParams.w !== undefined) {
                headers.set("X-CV-Resize-W", String(resizeParams.w));
              }
              if (resizeParams.h !== undefined) {
                headers.set("X-CV-Resize-H", String(resizeParams.h));
              }
              const cl = transformed.headers.get("Content-Length");
              if (cl) headers.set("Content-Length", cl);
              stampGatekeeper(headers, gatekeeperOff);
              if (setSessionCookie) headers.append("Set-Cookie", setSessionCookie);
              ctx.waitUntil(transformed.arrayBuffer());
              return new Response(null, { status: 200, headers });
            }
          } catch (e) {
            console.error("[files-cdn] resize HEAD error:", e);
          }
        }

        const meta = await env.FILES.head(r2Key);
        if (!meta) {
          const nh = buildCors(origin);
          stampGatekeeper(nh, gatekeeperOff);
          return new Response("Not Found", { status: 404, headers: nh });
        }
        const headers = buildCors(origin);
        applyObjectHeaders(
          headers,
          r2Key,
          meta.httpMetadata?.contentType,
          meta.httpEtag,
          meta.size,
          true,
          gatekeeperActive
        );
        stampGatekeeper(headers, gatekeeperOff);
        if (setSessionCookie) headers.append("Set-Cookie", setSessionCookie);
        const res = new Response(null, { status: 200, headers });
        if (useEdgeCache) {
          ctx.waitUntil(cache.put(request, res.clone()));
        }
        return res;
      }

      const object = await env.FILES.get(r2Key);
      if (!object) {
        const nh = buildCors(origin);
        stampGatekeeper(nh, gatekeeperOff);
        return new Response("Not Found", { status: 404, headers: nh });
      }

      const headers = buildCors(origin);
      applyObjectHeaders(
        headers,
        r2Key,
        object.httpMetadata?.contentType,
        object.httpEtag,
        object.size,
        false,
        gatekeeperActive
      );
      stampGatekeeper(headers, gatekeeperOff);
      if (setSessionCookie) headers.append("Set-Cookie", setSessionCookie);
      if (resizeFallbackToBinding) {
        headers.set("X-CV-Resize", "skipped-fallback-full");
        if (resizeFallbackReason) {
          headers.set(
            "X-CV-Resize-Reason",
            resizeFallbackReason.slice(0, 120)
          );
        }
      }

      const res = new Response(object.body, {
        status: 200,
        headers,
      });

      /** Do not cache full R2 body under a URL that asked for ?w=/h= — avoids poisoned edge cache. */
      const skipEdgeCachePoisonedResize =
        useEdgeCache && resizeParams != null && resizeFallbackToBinding;
      if (useEdgeCache && !skipEdgeCachePoisonedResize) {
        ctx.waitUntil(cache.put(request, res.clone()));
      }

      return res;
    } catch (err) {
      console.error("[files-cdn] R2 error:", err);
      const eh = buildCors(origin);
      stampGatekeeper(eh, gatekeeperOff);
      return new Response("Internal Server Error", {
        status: 500,
        headers: eh,
      });
    }
  },
};

function mergeCors(h: Headers, origin: string): void {
  h.set("Access-Control-Allow-Origin", origin);
  if (origin !== "*") {
    h.set("Access-Control-Allow-Credentials", "true");
  }
}
