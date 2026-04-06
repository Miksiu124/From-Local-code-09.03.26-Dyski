import { NextRequest } from "next/server";
import { referralTrackGET } from "@/lib/referral-track-redirect";

/** Tier-1 style URL for ad networks: /r/ref/{code} — same tracking as /r/{code}. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  return referralTrackGET(request, code);
}
