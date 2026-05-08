"use client";

import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "framer-motion";
import { formatPrice } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function statusColor(s: string) {
  switch (s) {
    case "APPROVED":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/25";
    case "PENDING":
      return "bg-amber-500/15 text-amber-300 border-amber-500/25";
    case "REJECTED":
      return "bg-rose-500/15 text-rose-300 border-rose-500/25";
    case "EXPIRED":
      return "bg-slate-500/15 text-slate-300 border-slate-500/25";
    default:
      return "bg-white/5 text-muted-foreground border-white/10";
  }
}

export function PaymentsHistoryTable({
  rows,
  currentUserId: _currentUserId,
}: {
  rows: Record<string, unknown>[];
  currentUserId: string;
}) {
  const t = useTranslations("admin.payments");
  const reduceMotion = useReducedMotion();
  const parentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Record<string, unknown> | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 12,
  });

  const vItems = rowVirtualizer.getVirtualItems();

  const openRow = (r: Record<string, unknown>) => {
    setSel(r);
    setOpen(true);
  };

  const empty = rows.length === 0;

  return (
    <section className="rounded-2xl border border-white/[0.08] overflow-hidden bg-card/20">
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("revenueDashboard")}</h2>
      </div>
      {empty ? (
        <div className="p-10 text-center text-muted-foreground text-sm">{t("noPaymentsInRange")}</div>
      ) : (
        <div ref={parentRef} className="h-[min(60vh,520px)] overflow-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[1.2fr_1.1fr_0.7fr_0.9fr_0.75fr_0.9fr_1fr] gap-2 px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide border-b border-white/[0.06] sticky top-0 bg-background/95 backdrop-blur z-10">
              <span>{t("tableDate")}</span>
              <span>{t("tableUser")}</span>
              <span>{t("tablePackage")}</span>
              <span>{t("tableAmount")}</span>
              <span>{t("tableMethod")}</span>
              <span>{t("tableStatus")}</span>
              <span>{t("tableApprover")}</span>
            </div>
            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
              {vItems.map((vi) => {
                const r = rows[vi.index];
                const id = String(r.id ?? "");
                const user = r.user as { email?: string; name?: string | null } | undefined;
                const pkg = r.creditPackage as { name?: string } | undefined;
                const admin = r.admin as { email?: string; name?: string | null } | null | undefined;
                const approver =
                  admin && typeof admin === "object"
                    ? admin.name || admin.email || "—"
                    : "—";
                return (
                  <div
                    key={id}
                    className="absolute left-0 right-0 px-1"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${vi.size}px`,
                      transform: `translateY(${vi.start}px)`,
                    }}
                  >
                    <motion.button
                      type="button"
                      layoutId={reduceMotion ? undefined : `pay-row-${id}`}
                      className={cn(
                        "w-full grid grid-cols-[1.2fr_1.1fr_0.7fr_0.9fr_0.75fr_0.9fr_1fr] gap-2 px-2 py-2 text-left text-sm rounded-xl border border-transparent",
                        "hover:bg-white/[0.05] hover:border-white/[0.06] transition-colors",
                      )}
                      onClick={() => openRow(r)}
                    >
                      <span className="text-muted-foreground font-mono text-xs truncate">{String(r.createdAt ?? "").slice(0, 19)}</span>
                      <span className="truncate">
                        <span className="block font-medium truncate">{user?.email ?? "—"}</span>
                        {user?.name && <span className="block text-xs text-muted-foreground truncate">{user.name}</span>}
                      </span>
                      <span className="truncate text-xs">{pkg?.name ?? "—"}</span>
                      <span className="font-semibold tabular-nums">{formatPrice(Number(r.amount ?? 0))}</span>
                      <span className="text-xs font-medium">{String(r.paymentMethod ?? "")}</span>
                      <span>
                        <span className={cn("inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold", statusColor(String(r.status ?? "")))}>
                          {String(r.status ?? "")}
                        </span>
                      </span>
                      <span className="truncate text-xs text-muted-foreground">{approver}</span>
                    </motion.button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <div className="max-w-lg rounded-2xl border border-white/[0.1] bg-card p-6">
          <DialogHeader>
            <DialogTitle>{t("detailTitle")}</DialogTitle>
          </DialogHeader>
          {sel && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div className="text-muted-foreground">{t("tableAmount")}</div>
                <div className="font-semibold">{formatPrice(Number(sel.amount ?? 0))}</div>
                <div className="text-muted-foreground">{t("tableMethod")}</div>
                <div>{String(sel.paymentMethod ?? "")}</div>
                <div className="text-muted-foreground">{t("tableStatus")}</div>
                <div>{String(sel.status ?? "")}</div>
                <div className="text-muted-foreground">{t("tableTx")}</div>
                <div className="font-mono text-xs break-all">{String(sel.transactionCode ?? "")}</div>
              </div>
              <Button variant="secondary" className="w-full rounded-xl mt-2" onClick={() => setOpen(false)}>
                OK
              </Button>
            </div>
          )}
        </div>
      </Dialog>
    </section>
  );
}
