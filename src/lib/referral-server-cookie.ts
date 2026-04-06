import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { REF_COOKIE_MAX_AGE_SEC, REF_COOKIE_NAME } from "@/lib/referral-cookie";

/**
 * Sets the same ref cookie as the client-side ReferralCookieProvider / setRefCookie,
 * so attribution works even if JS runs late or the user opens /register before hydration.
 */
export function applyReferralCookieToResponse(
  res: NextResponse,
  request: NextRequest,
  rawCode: string
): void {
  const value = rawCode.trim().toUpperCase().slice(0, 32);
  if (!value) return;
  const secure =
    request.nextUrl.protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https";
  res.cookies.set(REF_COOKIE_NAME, value, {
    path: "/",
    maxAge: REF_COOKIE_MAX_AGE_SEC,
    sameSite: "lax",
    secure,
    httpOnly: false,
  });
}
