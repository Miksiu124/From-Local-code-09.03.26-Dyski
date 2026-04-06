"use client";

import { createPortal } from "react-dom";
import { useState, useRef, useLayoutEffect, useCallback, useEffect } from "react";
import Link from "next/link";
import { UserCircle, ExternalLink } from "lucide-react";

type Props = {
  /** Unique per table row (e.g. growth event id) — avoids duplicate DOM ids */
  anchorKey: string;
  userId: string;
  userEmail?: string | null;
  userName?: string | null;
  heading: string;
  /** Short hint that the UUID link opens admin profile */
  linkHint: string;
};

/**
 * Funnel table: UUID link + fixed-position hover card (escapes overflow-x-auto clipping).
 * Tooltip is pointer-events-none; primary navigation stays the UUID link.
 */
export function FunnelUserIdPreview({
  anchorKey,
  userId,
  userEmail,
  userName,
  heading,
  linkHint,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLAnchorElement>(null);

  const hasPreview = Boolean(userName?.trim() || userEmail?.trim());
  const primary = userName?.trim() || userEmail || "";
  const showEmailLine = Boolean(userName?.trim() && userEmail);

  const syncPosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.top, left: r.left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    syncPosition();
  }, [open, syncPosition]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => syncPosition();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, syncPosition]);

  const linkClass =
    "group inline-flex items-center gap-1.5 font-mono text-[11px] text-primary hover:text-primary/90 hover:underline underline-offset-2 max-w-full";

  if (!hasPreview) {
    return (
      <Link
        ref={anchorRef}
        href={`/admin/users?userId=${encodeURIComponent(userId)}`}
        className={linkClass}
        title={userId}
      >
        <span className="truncate">{userId}</span>
        <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
      </Link>
    );
  }

  const leftClamped =
    typeof window !== "undefined"
      ? Math.max(8, Math.min(pos.left, window.innerWidth - 8 - Math.min(304, window.innerWidth - 16)))
      : pos.left;

  return (
    <>
      <Link
        ref={anchorRef}
        href={`/admin/users?userId=${encodeURIComponent(userId)}`}
        className={`${linkClass} cursor-help`}
        title={`${primary} — ${userId}`}
        data-funnel-uid={anchorKey}
        onMouseEnter={() => {
          syncPosition();
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => {
          syncPosition();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
      >
        <span className="truncate">{userId}</span>
        <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
      </Link>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="tooltip"
            aria-hidden
            className="fixed z-[300] w-[min(19rem,calc(100vw-1rem))] rounded-xl border border-border bg-card/95 px-3 py-2.5 text-left shadow-xl backdrop-blur-md pointer-events-none motion-reduce:transition-none"
            style={{
              left: leftClamped,
              top: pos.top - 8,
              transform: "translateY(-100%)",
            }}
          >
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{heading}</p>
            <div className="flex gap-2.5">
              <UserCircle className="h-9 w-9 shrink-0 text-primary/85" aria-hidden />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate font-semibold leading-tight text-foreground text-sm">{primary}</p>
                {showEmailLine ? (
                  <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
                ) : null}
                <p className="truncate font-mono text-[10px] text-muted-foreground/90 mt-0.5" title={userId}>
                  {userId}
                </p>
                <p className="text-[10px] text-muted-foreground/80 mt-1.5 leading-snug">{linkHint}</p>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
