import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { FavoritesGrid } from "@/components/user/favorites-grid";

export default async function FavoritesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <FavoritesGrid />
    </div>
  );
}
