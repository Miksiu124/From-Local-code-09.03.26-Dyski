import { NextRequest, NextResponse } from "next/server";
import { fetchApi } from "@/lib/api-client";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ slug: string }> }
) {
    const { slug } = await params;

    const cfIp = request.headers.get("cf-connecting-ip");
    const forwardedFor = request.headers.get("x-forwarded-for");
    const userAgent = request.headers.get("user-agent");
    const referer = request.headers.get("referer");

    const customHeaders: HeadersInit = {};
    if (cfIp) {
        customHeaders["cf-connecting-ip"] = cfIp;
        customHeaders["x-forwarded-for"] = cfIp;
    } else if (forwardedFor) {
        customHeaders["x-forwarded-for"] = forwardedFor;
    }

    if (userAgent) customHeaders["user-agent"] = userAgent;
    if (referer) customHeaders["referer"] = referer;

    try {
        const data = await fetchApi<{ destination?: string; linkId?: string }>(`/public/links/${slug}`, {
            headers: customHeaders,
            cache: "no-store",
        });

        if (data && data.destination) {
            // Append base url if it's a relative path just in case, or let browser handle it.
            // URL() constructor expects an absolute URL for redirect. Next.js NextResponse.redirect handles both relative and absolute.
            // If the destination is external (starts with http), we pass it as is.
            // If it's internal (relative, e.g. /models/foo), NextResponse.redirect needs a full URL created with `new URL(dest, request.url)`

            let redirectUrlStr = data.destination;
            if (!redirectUrlStr.startsWith("http://") && !redirectUrlStr.startsWith("https://")) {
                // It's a relative link, we need to construct the full URL
                // We shouldn't use request.url here because behind Docker/Nginx it might be http://0.0.0.0:3000
                const protocol = request.headers.get("x-forwarded-proto") || "https";
                const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "dyskiof.net";

                // Ensure proper absolute format
                const baseUrl = `${protocol}://${host}`;
                redirectUrlStr = new URL(redirectUrlStr, baseUrl).toString();
            }

            const response = NextResponse.redirect(redirectUrlStr, 302);

            if (data.linkId) {
                // Set cookie for 30 days
                response.cookies.set("ref_link_id", data.linkId, {
                    maxAge: 30 * 24 * 60 * 60,
                    path: "/",
                    httpOnly: true,
                    sameSite: "lax",
                    secure: process.env.NODE_ENV === "production"
                });
            }

            return response;
        }
    } catch (error) {
        // Link not found or API error, fallback
        console.error(`[Custom Links] Error resolving custom link /l/${slug}:`, error);
    }

    // Fallback if link not found or inactive
    const protocol = request.headers.get("x-forwarded-proto") || "https";
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "dyskiof.net";
    const fallbackUrl = `${protocol}://${host}/`;

    return NextResponse.redirect(fallbackUrl, 302);
}
