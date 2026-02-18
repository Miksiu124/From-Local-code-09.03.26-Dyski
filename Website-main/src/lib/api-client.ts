import { headers } from "next/headers";

const BASE_URL = process.env.API_URL || "http://localhost:8080/api";

export async function fetchApi<T>(path: string, options: RequestInit = {}): Promise<T> {
    // Extract cookies from the incoming request (Next.js Server Component)
    const headersList = await headers();
    const cookie = headersList.get("cookie") || "";

    const url = `${BASE_URL}${path}`;

    try {
        const res = await fetch(url, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                // Forward the session cookie so the Go backend knows who is logged in
                Cookie: cookie,
                ...options.headers,
            },
            // Ensure we always get fresh data by default
            cache: options.cache || "no-store",
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
