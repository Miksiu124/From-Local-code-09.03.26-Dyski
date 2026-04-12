import { NextRequest, NextResponse } from "next/server";
import { fetchApi } from "@/lib/api-client";
import { applyReferralCookieToResponse } from "@/lib/referral-server-cookie";

/**
 * Shared handler for GET /r/[code] and GET /r/ref/[code] (ads that require an extra path segment).
 */
export async function referralTrackGET(request: NextRequest, codeRaw: string): Promise<NextResponse> {
  const code = codeRaw?.trim() || "";

  if (!code || code.length > 32) {
    const protocol = request.headers.get("x-forwarded-proto") || "https";
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "dyskiof.net";
    return NextResponse.redirect(`${protocol}://${host}/`, 302);
  }

  const cfIp = request.headers.get("cf-connecting-ip");
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const userAgent = request.headers.get("user-agent");
  const referer = request.headers.get("referer");

  const customHeaders: HeadersInit = {};
  const clientIp = cfIp || realIp || forwardedFor;
  if (clientIp) {
    customHeaders["x-forwarded-for"] = clientIp;
    customHeaders["x-real-ip"] = clientIp;
  }
  if (userAgent) customHeaders["user-agent"] = userAgent;
  if (referer) customHeaders["referer"] = referer;

  const url = new URL(request.url);
  const v = url.searchParams.get("v");
  const apiUrl = v
    ? `/public/referral/${encodeURIComponent(code)}?v=${encodeURIComponent(v)}`
    : `/public/referral/${encodeURIComponent(code)}`;

  try {
    const data = await fetchApi<{ redirect?: string }>(apiUrl, {
      headers: customHeaders,
      cache: "no-store",
    });

    if (data?.redirect) {
      const res = NextResponse.redirect(data.redirect, 302);
      applyReferralCookieToResponse(res, request, code);
      return res;
    }
  } catch (error) {
    console.error(`[Referral] Error resolving referral track for code ${code}:`, error);
  }

  const protocol = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "dyskiof.net";
  const baseUrl = `${protocol}://${host}`;
  const res = NextResponse.redirect(`${baseUrl}/?ref=${encodeURIComponent(code)}`, 302);
  applyReferralCookieToResponse(res, request, code);
  return res;
}
