import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/session-server";
import { ReferralPanel } from "@/components/user/referral-panel";

export default async function ReferralPage() {
  const user = await getServerUser();

  if (!user) {
    redirect("/login?redirect=" + encodeURIComponent("/referral"));
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <div className="absolute inset-0 hero-gradient pointer-events-none" />
      <ReferralPanel />
    </div>
  );
}
