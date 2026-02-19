import { cookies } from "next/headers";

interface UserSession {
    id: string;
    name: string;
    email: string;
    role: string;
    creditBalance: number;
}

/**
 * Verifies the session with the Go backend using the session_token cookie.
 * This is the sole authentication mechanism for Server Components.
 */
export async function getServerUser(): Promise<UserSession | null> {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("session_token")?.value;

    if (!sessionToken) {
        return null;
    }

    try {
        const isDocker = process.env.HOSTNAME === "0.0.0.0" || process.env.API_HOST === "api";
        const defaultApiUrl = isDocker ? "http://api:8080/api" : "http://localhost:8080/api";
        let apiUrl = process.env.API_URL || defaultApiUrl;

        if (isDocker && apiUrl.includes("localhost:8080")) {
            apiUrl = apiUrl.replace("localhost:8080", "api:8080");
        }

        const res = await fetch(`${apiUrl}/auth/me`, {
            headers: {
                Cookie: `session_token=${sessionToken}`,
            },
            next: { revalidate: 0 },
        });

        if (res.ok) {
            return await res.json();
        }

        return null;
    } catch {
        return null;
    }
}
