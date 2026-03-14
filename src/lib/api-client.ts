import { headers } from "next/headers";

const BASE_URL = process.env.API_URL || "http://localhost:8080/api";

export type FetchApiOptions = RequestInit & {
  /** Revalidate cache after N seconds. Use for public data (models, countries, settings, stats). */
  revalidate?: number;
};

export async function fetchApi<T>(path: string, options: FetchApiOptions = {}): Promise<T> {
    const { revalidate, ...fetchOptions } = options;

    // Extract cookies from the incoming request (Next.js Server Component)
    const headersList = await headers();
    const cookie = headersList.get("cookie") || "";

    const isDocker = process.env.HOSTNAME === "0.0.0.0" || process.env.API_HOST === "api";
    const defaultApiUrl = isDocker ? "http://api:8080/api" : "http://localhost:8080/api";
    const envApiUrl = process.env.API_URL;

    let baseUrl = envApiUrl || defaultApiUrl;

    // Fix host if in Docker but config says localhost
    if (isDocker && baseUrl.includes("localhost:8080")) {
        baseUrl = baseUrl.replace("localhost:8080", "api:8080");
    }

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
