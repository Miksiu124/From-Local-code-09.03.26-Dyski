import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Long-lived SSE / admin streams behind nginx */
export const maxDuration = 360;

function upstreamOrigin(): string {
  let url = process.env.API_URL?.trim();
  if (!url) {
    const docker = process.env.HOSTNAME === "0.0.0.0" || process.env.API_HOST === "api";
    return docker ? "http://api:8080" : "http://localhost:8080";
  }
  url = url.replace(/\/$/, "");
  if (url.endsWith("/api")) {
    return url.slice(0, -4);
  }
  return url;
}

function buildTargetUrl(req: NextRequest, pathSegments: string[] | undefined): string {
  const origin = upstreamOrigin();
  const part = pathSegments?.length ? pathSegments.join("/") : "";
  const apiPath = part ? `/api/${part}` : "/api";
  return `${origin}${apiPath}${req.nextUrl.search}`;
}

function forwardRequestHeaders(req: NextRequest): Headers {
  const h = new Headers();
  const cookie = req.headers.get("cookie");
  if (cookie) h.set("cookie", cookie);
  const auth = req.headers.get("authorization");
  if (auth) h.set("authorization", auth);
  const ct = req.headers.get("content-type");
  if (ct) h.set("content-type", ct);
  const accept = req.headers.get("accept");
  if (accept) h.set("accept", accept);
  const lang = req.headers.get("accept-language");
  if (lang) h.set("accept-language", lang);
  for (const name of ["cf-connecting-ip", "x-forwarded-for", "x-real-ip", "user-agent", "referer"]) {
    const v = req.headers.get(name);
    if (v) h.set(name, v);
  }
  return h;
}

async function proxy(req: NextRequest, pathSegments: string[] | undefined): Promise<Response> {
  const url = buildTargetUrl(req, pathSegments);
  const headers = forwardRequestHeaders(req);
  const method = req.method.toUpperCase();

  if (method === "GET" || method === "HEAD") {
    return fetch(url, { method, headers, cache: "no-store" });
  }

  if (method === "OPTIONS") {
    return fetch(url, { method: "OPTIONS", headers, cache: "no-store" });
  }

  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    cache: "no-store",
  };
  if (req.body) {
    init.body = req.body;
    init.duplex = "half";
  }

  return fetch(url, init);
}

type Ctx = { params: Promise<{ path?: string[] }> };

async function handle(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  const upstream = await proxy(req, path);
  const out = new Headers(upstream.headers);
  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx);
}
export async function HEAD(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx);
}
export async function OPTIONS(req: NextRequest, ctx: Ctx) {
  return handle(req, ctx);
}
