export const PAYMENTS_ME_ADMIN_ID = "3bb2c5b5-b4bd-4189-9bef-3a54458ff5ac";
export const PAYMENTS_PARTNER_ADMIN_ID = "2e12d2b5-209f-43c6-8d4d-089082155a33";

export function resolvePaymentsAdminScope(scope: string | null | undefined): {
  adminId?: string;
  partnerOnly?: boolean;
} {
  if (scope === "me") {
    return { adminId: PAYMENTS_ME_ADMIN_ID };
  }
  if (scope === "partner") {
    return { adminId: PAYMENTS_PARTNER_ADMIN_ID };
  }
  return {};
}
