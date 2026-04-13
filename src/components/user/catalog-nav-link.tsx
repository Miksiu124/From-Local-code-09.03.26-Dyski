"use client";

import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, type MouseEvent } from "react";

type CatalogNavLinkProps = LinkProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps>;

/**
 * Client navigation with View Transitions API when supported (Chromium, Safari 18+).
 * Falls back to default Next.js navigation. Skips when reduced-motion is preferred.
 */
export function CatalogNavLink({ href, onClick, children, ...rest }: CatalogNavLinkProps) {
  const router = useRouter();

  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      if (typeof document === "undefined" || typeof window === "undefined") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const doc = document as Document & {
        startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void> };
      };
      if (typeof doc.startViewTransition !== "function") return;

      const target =
        typeof href === "string"
          ? href
          : `${(href as { pathname?: string }).pathname ?? ""}${(href as { search?: string }).search ?? ""}` ||
            "/";
      if (!target.startsWith("/models/")) return;

      e.preventDefault();
      doc.startViewTransition(() => {
        router.push(target);
      });
    },
    [href, onClick, router],
  );

  return (
    <Link href={href} onClick={handleClick} {...rest}>
      {children}
    </Link>
  );
}
