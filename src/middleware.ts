import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { emitSecurityEvent } from "@/lib/security-events";

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

export async function middleware(request: NextRequest) {
  const method = request.method.toUpperCase();
  const isSafeMethod = method === "GET" || method === "HEAD" || method === "OPTIONS";
  const pathname = request.nextUrl.pathname;

  const isAuthRoute = pathname.startsWith("/api/auth/");
  const safeOrigin = isSafeOrigin(request);
  const ip = getClientIp(request);

  if (!isSafeMethod && !isAuthRoute && !safeOrigin) {
    const origin = request.headers.get("origin");
    const expected = request.nextUrl.origin;
    emitSecurityEvent("csrf.blocked", ip, pathname, {
      origin: origin ?? "(missing)",
      expected,
    });
    return new NextResponse("Invalid origin", { status: 403 });
  }

  // OPTIONS still gets rate-limited, but with a higher ceiling (300/min)
  // to avoid blocking legitimate CORS pre-flights while preventing abuse.
  const isOptions = request.method === "OPTIONS";
  const key = `${ip}:${request.nextUrl.pathname}`;
  const result = await checkRateLimit(
    key,
    isOptions ? 500 : 400,
    60_000
  );

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

export const config = {
  matcher: ["/api/:path*"],
};
