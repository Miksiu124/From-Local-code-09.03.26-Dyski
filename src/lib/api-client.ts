import { headers } from "next/headers";

/** Base URL for Go API (server-side). Must reach `api` in Docker, never `localhost` from the frontend container. */
function getServerApiBaseUrl(): string {
  const fromEnv = process.env.API_URL?.trim();
  if (fromEnv) {
    let u = fromEnv;
    if (u.includes("localhost:8080") && process.env.API_HOST === "api") {
      u = u.replace("localhost:8080", "api:8080");
    }
    return u.endsWith("/") ? u.slice(0, -1) : u;
  }
  if (process.env.API_HOST === "api") {
    return "http://api:8080/api";
  }
  if (process.env.HOSTNAME === "0.0.0.0") {
    return "http://api:8080/api";
  }
  return "http://localhost:8080/api";
}

export type FetchApiOptions = RequestInit & {
  /** Revalidate cache after N seconds. Use for public data (models, countries, settings, stats). */
  revalidate?: number;
};

export async function fetchApi<T>(path: string, options: FetchApiOptions = {}): Promise<T> {
    const { revalidate, ...fetchOptions } = options;

    // Extract cookies from the incoming request (Next.js Server Component)
    const headersList = await headers();
    const cookie = headersList.get("cookie") || "";

    const baseUrl = getServerApiBaseUrl();
    const url = `${baseUrl}${path}`;

    try {
        const res = await fetch(url, {
            ...fetchOptions,
            headers: {
                "Content-Type": "application/json",
                Cookie: cookie,
                ...(fetchOptions.headers as Record<string, string>),
            },
            cache: revalidate == null ? "no-store" : undefined,
            next: revalidate != null ? { revalidate } : undefined,
        });

        if (!res.ok) {
            // If 404, we might want to return null, but let's throw for now unless handled
            if (res.status === 404) return null as T;
            console.error(`API Error ${res.status} at ${url}: ${res.statusText}`);
            throw new Error(`API Error ${res.status}: ${res.statusText}`);
        }

        return res.json();
    } catch (err) {
        console.error(`Fetch failed for ${url}:`, err);
        throw err;
    }
}
