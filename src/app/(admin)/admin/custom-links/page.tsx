import { cookies } from "next/headers";
import { fetchCustomLinks } from "@/lib/admin-api";
import { CustomLinksClient } from "@/components/admin/custom-links-client";

export default async function AdminCustomLinksPage() {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("session_token")?.value;

    // Admin layout already verified auth; prefetch with same session for immediate display
    const initialLinks = sessionToken ? await fetchCustomLinks(sessionToken) : [];

    return <CustomLinksClient initialLinks={initialLinks} />;
}
