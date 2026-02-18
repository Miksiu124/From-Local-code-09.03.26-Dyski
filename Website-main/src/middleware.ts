import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";

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

function isSafeOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const expectedOrigin = request.nextUrl.origin;

  if (origin) {
    return origin === expectedOrigin;
  }

  if (referer) {
    return referer.startsWith(expectedOrigin);
  }

  return true;
}

export async function middleware(request: NextRequest) {
  const method = request.method.toUpperCase();
  const isSafeMethod = method === "GET" || method === "HEAD" || method === "OPTIONS";
  const pathname = request.nextUrl.pathname;

  // Skip CSRF check for NextAuth routes entirely - they handle their own security
  const isAuthRoute = pathname.startsWith("/api/auth/");

  if (!isSafeMethod && !isAuthRoute && !isSafeOrigin(request)) {
    return new NextResponse("Invalid origin", { status: 403 });
  }

  // OPTIONS still gets rate-limited, but with a higher ceiling (300/min)
  // to avoid blocking legitimate CORS pre-flights while preventing abuse.
  const isOptions = request.method === "OPTIONS";

  const ip = getClientIp(request);
  const key = `${ip}:${request.nextUrl.pathname}`;
  const result = await checkRateLimit(
    key,
    isOptions ? 300 : 120,
    60_000
  );

  if (!result.allowed) {
    return new NextResponse("Too Many Requests", {
      status: 429,
      headers: {
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
  matcher: ["/api/:path*", "/api_legacy/:path*"],
};
