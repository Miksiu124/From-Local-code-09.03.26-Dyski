/**
 * Maps "Approved by" filter to API query params.
 * - me: purchases you approved (cp.admin_id = current admin user)
 * - partner: everyone except you (backend partnerOnly=1), matches "Partner (reszta)" / "Partner (others)"
 */
export function resolvePaymentsAdminScope(
  scope: string | null | undefined,
  currentAdminUserId: string | null | undefined,
): {
  adminId?: string;
  partnerOnly?: boolean;
} {
  if (scope === "me") {
    const id = currentAdminUserId?.trim();
    if (id) return { adminId: id };
    return {};
  }
  if (scope === "partner") {
    return { partnerOnly: true };
  }
  return {};
}
