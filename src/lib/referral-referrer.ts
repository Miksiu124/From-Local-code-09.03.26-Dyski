/** Parsed referrer row from GET /admin/credits/purchases (referralReferrer). Server-safe — no "use client". */

export type ReferralReferrer = { id: string; email: string; name: string | null };

export function parseReferralReferrer(raw: unknown): ReferralReferrer | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return null;
  return {
    id: o.id,
    email: typeof o.email === "string" ? o.email : "",
    name: o.name === null || o.name === undefined ? null : String(o.name),
  };
}
