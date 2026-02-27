import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/session-server";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { isAdmin } from "@/lib/admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getServerUser();

  if (!user) {
    redirect("/login?error=admin_no_session");
  }

  const isAllowed = isAdmin(user.email, user.role);

  if (!isAllowed) {
    console.error("[AdminLayout] ACCESS DENIED for user role:", user.role);
    redirect("/login?error=admin_access_denied");
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      <AdminSidebar />
      <div className="flex-1 p-4 sm:p-6 pb-20 lg:pb-6 overflow-auto">{children}</div>
    </div>
  );
}
