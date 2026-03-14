/**
 * Server-side API helpers for admin pages.
 * Uses session_token cookie to fetch from the Go backend.
 */

function getApiUrl(): string {
    const isDocker = process.env.HOSTNAME === "0.0.0.0" || process.env.API_HOST === "api";
    let apiUrl = process.env.API_URL || (isDocker ? "http://api:8080/api" : "http://localhost:8080/api");
    if (isDocker && apiUrl.includes("localhost:8080")) {
        apiUrl = apiUrl.replace("localhost:8080", "api:8080");
    }
    return apiUrl;
}

export interface CustomLink {
    id: string;
    slug: string;
    destination: string;
    description: string | null;
    isActive: boolean;
    createdAt: string;
    visitsCount: number;
    registrationsCount: number;
    purchasesCount: number;
    revenue: number;
    dailyClicks?: { date: string; count: number }[];
}

export async function fetchCustomLinks(sessionToken: string): Promise<CustomLink[]> {
    const apiUrl = getApiUrl();
    const res = await fetch(`${apiUrl}/admin/custom-links`, {
        headers: { Cookie: `session_token=${sessionToken}` },
        next: { revalidate: 0 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
}
