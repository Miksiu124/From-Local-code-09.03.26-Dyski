/**
 * Admin access is determined by the Go backend.
 * The /api/auth/me endpoint returns role: "ADMIN" for admin users.
 * This helper is retained only for edge cases where a quick client-side
 * check is needed before the server response arrives.
 */

export function isAdmin(
  email: string | null | undefined,
  role?: string | null
): boolean {
  if (role && role.toUpperCase() === "ADMIN") {
    return true;
  }
  return false;
}
