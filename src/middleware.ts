import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { emitSecurityEvent } from "@/lib/security-events";
import { apexHostname, isWwwHost } from "@/lib/site-url";

function getClientIp(request: NextRequest): string {
  // Prefer Cloudflare's verified header (cannot be spoofed behind CF)
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;

  // Next: the rightmost IP in x-forwarded-for is typically set by the
  // outermost trusted proxy. Use it only as a fallback.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // Take the first (client) IP — acceptable when behind a known proxy
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") || "unknown";
}

/** Same registrable host (ignores www. vs apex) and same scheme — for CSRF checks behind mixed hostnames. */
function sameSiteOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const ha = ua.hostname.replace(/^www\./i, "");
    const hb = ub.hostname.replace(/^www\./i, "");
    return ua.protocol === ub.protocol && ha === hb;
  } catch {
    return false;
  }
}

function isSafeOrigin(request: NextRequest) {
  const expectedOrigin = request.nextUrl.origin;

  // Browsers set this on fetch/XHR from the same document; allows POST when Origin/Referer are omitted
  // (e.g. strict Referrer-Policy) without weakening cross-site CSRF (evil sites send "cross-site").
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "same-origin") {
    return true;
  }

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (origin) {
    // Allow localhost:3000 even if nextUrl.origin thinks it is 0.0.0.0:3000
    if (origin === "http://localhost:3000" && expectedOrigin.includes("0.0.0.0")) {
      return true;
    }
    return origin === expectedOrigin || sameSiteOrigin(origin, expectedOrigin);
  }

  if (referer) {
    if (referer.startsWith("http://localhost:3000") && expectedOrigin.includes("0.0.0.0")) {
      return true;
    }
    if (referer.startsWith(expectedOrigin)) return true;
    try {
      const r = new URL(referer);
      if (sameSiteOrigin(r.origin, expectedOrigin)) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  // No Origin or Referer — block state-changing requests (CSRF protection)
  return false;
}

const isProd = process.env.NODE_ENV === "production";

/**
 * Origins that must appear in connect-src besides 'self':
 * - HLS segment URLs often hit the public CDN host (NEXT_PUBLIC_MEDIA_HOST), not R2 API.
 * - resolveApiPathForBrowser() may call NEXT_PUBLIC_APP_URL while the user is on www
 *   (or the reverse) — those are different origins than 'self'.
 */
function connectSrcOrigins(): string[] {
  const origins = new Set<string>();

  const tryAddUrlOrigin = (raw: string | undefined) => {
    const s = raw?.trim();
    if (!s) return;
    try {
      const u = new URL(s);
      origins.add(`${u.protocol}//${u.host}`);
    } catch {
      /* ignore invalid env */
    }
  };

  tryAddUrlOrigin(process.env.NEXT_PUBLIC_APP_URL);
  tryAddUrlOrigin(process.env.NEXT_PUBLIC_BASE_URL);

  const mediaHosts = (process.env.NEXT_PUBLIC_MEDIA_HOST || "files.dyskiof.net")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  for (const h of mediaHosts) {
    origins.add(`https://${h}`);
  }

  return [...origins];
}

/** Build a per-request nonce-based Content-Security-Policy header. */
function buildCSP(nonce: string): string {
  // 'strict-dynamic' lets nonced scripts load further scripts without explicit
  // host allowlisting in modern browsers; the host fallback below is for
  // browsers that don't yet honor strict-dynamic.
  // Dev keeps 'unsafe-eval' because Next.js dev server uses eval for HMR.
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "https://challenges.cloudflare.com",
    isProd ? "" : "'unsafe-eval'",
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `script-src-elem ${scriptSrc}`,
    // Tailwind / next-intl / runtime style injection still need 'unsafe-inline'.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com https://files.dyskiof.net",
    "font-src 'self' data:",
    // connect-src: include CDN + canonical app URL(s) so HLS.js XHR to presigned
    // URLs and cross-subdomain API playlists is not blocked (see connectSrcOrigins).
    [
      "connect-src 'self'",
      ...connectSrcOrigins(),
      "https://*.r2.cloudflarestorage.com",
      "https://challenges.cloudflare.com",
    ].join(" "),
    "media-src 'self' blob: https://*.r2.cloudflarestorage.com https://files.dyskiof.net",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'self' https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    isProd ? "upgrade-insecure-requests" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** Edge-runtime-safe nonce: 16 random bytes as base64. */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  // btoa is available in the Edge runtime
  return btoa(bin);
}

/** 301 www → apex so canonical URLs and link equity stay on one host. */
function redirectWwwToApex(request: NextRequest): NextResponse | null {
  const host = request.headers.get("host");
  if (!isWwwHost(host)) return null;

  const url = request.nextUrl.clone();
  url.hostname = apexHostname(host ?? "");
  return NextResponse.redirect(url, 301);
}

export async function middleware(request: NextRequest) {
  const wwwRedirect = redirectWwwToApex(request);
  if (wwwRedirect) return wwwRedirect;

  const method = request.method.toUpperCase();
  const isSafeMethod = method === "GET" || method === "HEAD" || method === "OPTIONS";
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith("/api/");
  const ip = getClientIp(request);

  // ── API routes: CSRF check + rate limiting ────────────────────────────────
  if (isApi) {
    const safeOrigin = isSafeOrigin(request);

    // Auth endpoints used to bypass the origin check — that left /login,
    // /logout, /register, /forgot-password, /reset-password vulnerable to
    // forced-action CSRF that SameSite=Lax doesn't fully cover (e.g. iframe
    // top-nav). Apply the same check uniformly. The Discord OAuth callback is
    // a GET (handled by the safe-method branch) and is unaffected.
    if (!isSafeMethod && !safeOrigin) {
      const origin = request.headers.get("origin");
      const expected = request.nextUrl.origin;
      emitSecurityEvent("csrf.blocked", ip, pathname, {
        origin: origin ?? "(missing)",
        expected,
      });
      return new NextResponse("Invalid origin", { status: 403 });
    }

    const isOptions = method === "OPTIONS";
    const key = `${ip}:${pathname}`;
    const result = await checkRateLimit(key, isOptions ? 500 : 400, 60_000);

    if (!result.allowed) {
      emitSecurityEvent("ratelimit.hit", ip, pathname, {
        limit: result.limit,
        remaining: 0,
        reset_at: result.resetAt,
      });
      const retryAfterSecs = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      return new NextResponse("Too Many Requests", {
        status: 429,
        headers: {
          "Retry-After": retryAfterSecs.toString(),
          "X-RateLimit-Limit": result.limit.toString(),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": result.resetAt.toString(),
        },
      });
    }

    const response = NextResponse.next();
    response.headers.set("X-RateLimit-Limit", result.limit.toString());
    response.headers.set("X-RateLimit-Remaining", result.remaining.toString());
    response.headers.set("X-RateLimit-Reset", result.resetAt.toString());
    return response;
  }

  // ── HTML routes: per-request CSP nonce ────────────────────────────────────
  // Next.js automatically reads `x-nonce` from the request headers and
  // applies it to inline framework scripts. Third-party <Script> components
  // pick it up via `headers().get('x-nonce')` in layouts.
  const nonce = generateNonce();
  const csp = buildCSP(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Forward the CSP on the request as well so server components can mirror it
  // when rendering streaming HTML.
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Skip Next internals and obvious static assets so we don't waste cycles
    // generating nonces for files that don't need a CSP.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|woff|woff2|ttf|otf|css|js|map)$).*)",
  ],
};
