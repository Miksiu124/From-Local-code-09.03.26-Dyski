import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// ── Per-user SSE connection tracking ─────────────────────────────────────────
const MAX_SSE_PER_USER = 5;

function getConnectionMap() {
  const g = globalThis as typeof globalThis & { __sseConnections?: Map<string, number> };
  if (!g.__sseConnections) g.__sseConnections = new Map();
  return g.__sseConnections;
}

function acquireSlot(userId: string): boolean {
  const map = getConnectionMap();
  const current = map.get(userId) ?? 0;
  if (current >= MAX_SSE_PER_USER) return false;
  map.set(userId, current + 1);
  return true;
}

function releaseSlot(userId: string) {
  const map = getConnectionMap();
  const current = map.get(userId) ?? 0;
  if (current <= 1) map.delete(userId);
  else map.set(userId, current - 1);
}

/**
 * SSE endpoint: streams payment status updates for a given credit purchase.
 * Client connects via EventSource; receives { status } events.
 * Falls back gracefully — client can still poll `/status` if SSE is unsupported.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;

  // Validate id is alphanumeric (cuid)
  if (!/^[a-z0-9]+$/i.test(id)) {
    return new Response("Invalid id", { status: 400 });
  }

  // Verify ownership
  const purchase = await db.creditPurchase.findUnique({
    where: { id },
    select: { userId: true, status: true },
  });

  if (!purchase || purchase.userId !== session.user.id) {
    return new Response("Not found", { status: 404 });
  }

  // If already resolved, send one event and close
  if (purchase.status !== "PENDING") {
    const body = `data: ${JSON.stringify({ status: purchase.status })}\n\n`;
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  // Enforce per-user connection limit
  if (!acquireSlot(session.user.id)) {
    return new Response("Too many active connections", { status: 429 });
  }

  // Stream status every 3 seconds until resolved or timeout (5 min)
  const encoder = new TextEncoder();
  const MAX_DURATION_MS = 5 * 60 * 1000;
  const POLL_INTERVAL_MS = 3_000;

  // Shared interval ref so cancel() can clear it
  let intervalId: ReturnType<typeof setInterval> | null = null;
  const userId = session.user.id;

  const stream = new ReadableStream({
    start(controller) {
      const startedAt = Date.now();

      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream may already be closed
          cleanup();
        }
      };

      let slotReleased = false;
      const cleanup = () => {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        if (!slotReleased) {
          slotReleased = true;
          releaseSlot(userId);
        }
      };

      // Send initial status
      send({ status: "PENDING" });

      intervalId = setInterval(async () => {
        try {
          // Check timeout
          if (Date.now() - startedAt > MAX_DURATION_MS) {
            send({ status: "TIMEOUT" });
            cleanup();
            try { controller.close(); } catch { /* already closed */ }
            return;
          }

          const current = await db.creditPurchase.findUnique({
            where: { id },
            select: { status: true },
          });

          if (!current) {
            cleanup();
            try { controller.close(); } catch { /* already closed */ }
            return;
          }

          send({ status: current.status });

          if (current.status !== "PENDING") {
            cleanup();
            try { controller.close(); } catch { /* already closed */ }
          }
        } catch {
          cleanup();
          try { controller.close(); } catch { /* already closed */ }
        }
      }, POLL_INTERVAL_MS);
    },
    cancel() {
      // Client disconnected — clear interval and release connection slot
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      releaseSlot(userId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
