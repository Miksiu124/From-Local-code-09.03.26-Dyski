/**
 * Admin access is controlled by the database role or the ADMIN_EMAILS env var.
 * Emails listed in ADMIN_EMAILS (comma-separated) always have admin privileges.
 */

const ADMIN_EMAILS: string[] = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdmin(
  email: string | null | undefined,
  role?: string | null
): boolean {
  if (role && role.toUpperCase() === "ADMIN") return true;
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
