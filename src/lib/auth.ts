/**
 * Authentication is handled entirely by the Go backend.
 * Session verification uses getServerUser() from session-server.ts
 * which calls the Go backend's /api/auth/me endpoint.
 *
 * The Go backend handles:
 * - Registration (POST /api/auth/register)
 * - Login (POST /api/auth/login) — sets HttpOnly session_token cookie
 * - Logout (POST /api/auth/logout) — clears cookie + Redis session
 * - Session verification (GET /api/auth/me)
 *
 * NextAuth has been removed. All authentication flows go through Go.
 */

export {};
