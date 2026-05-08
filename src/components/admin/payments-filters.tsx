"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolvePaymentsAdminScope } from "@/lib/payments-admin-scope";

const METHODS = ["BLIK", "CRYPTO", "PAYPAL", "REVOLUT"] as const;

function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}

function localInputToIso(v: string): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

export function PaymentsFilters({ onApply }: { onApply: () => void }) {
  const t = useTranslations("admin.payments");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [from, setFrom] = useState(sp.get("from") ?? "");
  const [to, setTo] = useState(sp.get("to") ?? "");
  const [method, setMethod] = useState(sp.get("paymentMethod") ?? "");
  const [adminScope, setAdminScope] = useState(sp.get("adminScope") ?? "all"); // all | me | partner
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [status, setStatus] = useState(sp.get("status") ?? "");

  const apply = useCallback(() => {
    const p = new URLSearchParams(sp.toString());
    const setOrDel = (key: string, val: string) => {
      if (val) p.set(key, val);
      else p.delete(key);
    };
    setOrDel("from", from.trim());
    setOrDel("to", to.trim());
    setOrDel("paymentMethod", method);
    p.delete("adminId");
    p.delete("partnerOnly");
    const scoped = resolvePaymentsAdminScope(adminScope);
    if (scoped.adminId) p.set("adminId", scoped.adminId);
    else if (scoped.partnerOnly) p.set("partnerOnly", "1");
    setOrDel("adminScope", adminScope === "all" ? "" : adminScope);
    setOrDel("q", q.trim());
    setOrDel("status", status);
    p.delete("cursorBefore");
    p.delete("cursorBeforeId");
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    onApply();
  }, [adminScope, from, method, onApply, pathname, q, router, sp, status, to]);

  const reset = useCallback(() => {
    router.replace(pathname, { scroll: false });
    setFrom("");
    setTo("");
    setMethod("");
    setAdminScope("all");
    setQ("");
    setStatus("");
    onApply();
  }, [onApply, pathname, router]);

  return (
    <section className="sticky top-0 z-30 -mx-1 px-1 py-2 backdrop-blur-md bg-background/70 border border-white/[0.06] rounded-2xl" aria-label={t("ariaFilters")}>
      <div className="flex items-center gap-2 px-2 pb-2 text-sm font-semibold">
        <Filter className="h-4 w-4 text-primary" />
        {t("filters")}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6 px-2 pb-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("dateFrom")}
          <input
            type="datetime-local"
            value={isoToLocalInput(from)}
            onChange={(e) => setFrom(localInputToIso(e.target.value))}
            className={cn(
              "rounded-xl border border-white/[0.1] bg-black/30 px-2 py-1.5 text-sm text-foreground",
              "focus:outline-none focus:ring-2 focus:ring-primary/40",
            )}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("dateTo")}
          <input
            type="datetime-local"
            value={isoToLocalInput(to)}
            onChange={(e) => setTo(localInputToIso(e.target.value))}
            className={cn(
              "rounded-xl border border-white/[0.1] bg-black/30 px-2 py-1.5 text-sm text-foreground",
              "focus:outline-none focus:ring-2 focus:ring-primary/40",
            )}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("method")}
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="rounded-xl border border-white/[0.1] bg-black/30 px-2 py-1.5 text-sm"
          >
            <option value="">{t("allMethods")}</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("adminFilter")}
          <select
            value={adminScope}
            onChange={(e) => setAdminScope(e.target.value)}
            className="rounded-xl border border-white/[0.1] bg-black/30 px-2 py-1.5 text-sm"
          >
            <option value="all">{t("allAdmins")}</option>
            <option value="me">{t("me")}</option>
            <option value="partner">{t("partner")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("tableStatus")}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-xl border border-white/[0.1] bg-black/30 px-2 py-1.5 text-sm"
          >
            <option value="">All</option>
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="EXPIRED">EXPIRED</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("search")}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="rounded-xl border border-white/[0.1] bg-black/30 px-2 py-1.5 text-sm"
            placeholder="…"
          />
        </label>
      </div>
      <div className="flex gap-2 px-2 pb-2">
        <Button size="sm" className="rounded-xl" onClick={() => void apply()}>
          {t("apply")}
        </Button>
        <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => void reset()}>
          {t("reset")}
        </Button>
      </div>
    </section>
  );
}
