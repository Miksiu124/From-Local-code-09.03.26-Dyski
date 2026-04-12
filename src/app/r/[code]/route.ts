import { NextRequest } from "next/server";
import { referralTrackGET } from "@/lib/referral-track-redirect";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  return referralTrackGET(request, code);
}
