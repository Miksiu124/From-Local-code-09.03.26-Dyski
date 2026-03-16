/**
 * Cloudflare Worker — serwuje TYLKO folder avatars/ z R2.
 * Wszystkie inne ścieżki zwracają 403 Forbidden.
 *
 * URL: https://avatars.twojadomena.com/avatars/slug_avatar.webp
 * Mapuje na R2: avatars/slug_avatar.webp
 */

const ALLOWED_PREFIX = "avatars/";

export default {
  async fetch(request: Request, env: { FILES: R2Bucket }): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    let path = url.pathname;

    // Usuń leading slash
    if (path.startsWith("/")) path = path.slice(1);

    // Tylko avatars/* — blokuj path traversal i inne ścieżki
    if (!path.startsWith(ALLOWED_PREFIX) || path.includes("..")) {
      return new Response("Forbidden", { status: 403 });
    }

    const r2Key = path; // avatars/slug_avatar.webp

    try {
      const object = await env.FILES.get(r2Key);
      if (!object) {
        return new Response("Not Found", { status: 404 });
      }

      const headers = new Headers();
      headers.set("Cache-Control", "public, max-age=86400");
      headers.set("Content-Type", object.httpMetadata?.contentType ?? "image/webp");

      if (object.etag) {
        headers.set("ETag", object.etag);
      }

      return new Response(object.body, {
        status: 200,
        headers,
      });
    } catch (err) {
      console.error("[avatars-cdn] R2 error:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};
