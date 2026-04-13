"use client";

import Link from "next/link";
import { UserCircle } from "lucide-react";
import type { ReferralReferrer } from "@/lib/referral-referrer";

export type { ReferralReferrer } from "@/lib/referral-referrer";

type Props = {
  badgeClassName: string;
  label: string;
  referrer: ReferralReferrer | null;
  referrerHeading: string;
  openProfileLabel: string;
};

/**
 * Hover preview for “user referral” source — shows referrer identity + link to admin Users.
 * CSS-only; no extra deps. Works without referrer (plain badge).
 */
export function PurchaseReferralSourceHover({
  badgeClassName,
  label,
  referrer,
  referrerHeading,
  openProfileLabel,
}: Props) {
  if (!referrer) {
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${badgeClassName}`}
      >
        {label}
      </span>
    );
  }

  const primary = referrer.name?.trim() || referrer.email;
  const showEmailLine = Boolean(referrer.name?.trim() && referrer.email);

  /** Tooltip uses ancestor `.group` (whole “Źródło” row) so hover on label works too. */
  return (
    <span className="relative inline-flex max-w-full justify-end">
      <span
        className={`inline-flex cursor-help items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${badgeClassName}`}
        tabIndex={0}
      >
        {label}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+8px)] right-0 z-[100] w-[min(19rem,calc(100vw-2rem))] rounded-xl border border-border bg-card/95 px-3 py-2.5 text-left shadow-xl opacity-0 backdrop-blur-md transition-opacity duration-150 ease-out motion-reduce:transition-none group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
      >
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {referrerHeading}
        </p>
        <div className="flex gap-2.5">
          <UserCircle className="h-9 w-9 shrink-0 text-primary/85" aria-hidden />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate font-semibold leading-tight text-foreground">{primary}</p>
            {showEmailLine ? (
              <p className="truncate text-xs text-muted-foreground">{referrer.email}</p>
            ) : null}
            <Link
              href={`/admin/users?userId=${encodeURIComponent(referrer.id)}`}
              className="mt-1 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {openProfileLabel}
            </Link>
          </div>
        </div>
      </span>
    </span>
  );
}
