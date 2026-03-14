/**
 * Referral code cookie – persists ?ref= across sessions (Last Click Wins).
 * HttpOnly: false so JS can read it for registration.
 */

const REF_COOKIE_NAME = "ref_code";
const REF_COOKIE_MAX_AGE_DAYS = 60;

export function setRefCookie(code: string): void {
  if (typeof document === "undefined" || !code || code.length > 32) return;
  const value = code.trim().toUpperCase().slice(0, 32);
  if (!value) return;
  const maxAge = REF_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  const secure = typeof window !== "undefined" && window.location?.protocol === "https:";
  document.cookie = `${REF_COOKIE_NAME}=${encodeURIComponent(value)};path=/;max-age=${maxAge};SameSite=Lax${secure ? ";Secure" : ""}`;
}

export function getRefCookie(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${REF_COOKIE_NAME}=([^;]*)`));
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]).trim().toUpperCase();
  } catch {
    return "";
  }
}
