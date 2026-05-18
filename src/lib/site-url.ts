/**
 * Canonical public site origin (apex host, no trailing slash).
 * Used for canonical URLs, sitemap, robots, Open Graph, and JSON-LD.
 */
export function getSiteUrl(): string {
  const raw = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "https://dyskiof.net"
  ).trim();

  try {
    const url = new URL(raw.endsWith("/") ? raw : `${raw}/`);
    url.hostname = url.hostname.replace(/^www\./i, "");
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.origin;
  } catch {
    return "https://dyskiof.net";
  }
}

/** True when the request Host header is a www. subdomain of the canonical site. */
export function isWwwHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return hostname.startsWith("www.");
}

/** Apex hostname from Host (strips www. and port). */
export function apexHostname(host: string): string {
  return host.split(":")[0]?.replace(/^www\./i, "") ?? host;
}
