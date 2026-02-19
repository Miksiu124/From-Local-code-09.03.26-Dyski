import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/session-server";
import { FavoritesGrid } from "@/components/user/favorites-grid";

export default async function FavoritesPage() {
  const user = await getServerUser();

  if (!user) {
    redirect("/login?callbackUrl=/favorites");
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <FavoritesGrid />
    </div>
  );
}
