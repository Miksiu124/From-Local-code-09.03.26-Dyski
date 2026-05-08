"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SettlementsHistory({
  settlements,
  onUndo,
}: {
  settlements: Record<string, unknown>[];
  onUndo: () => void;
}) {
  const t = useTranslations("admin.payments");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    queueMicrotask(tick);
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const undo = async (id: string) => {
    if (!confirm("Undo this settlement?")) return;
    const res = await fetch(`/api/admin/revenue/settlements/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) onUndo();
  };

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-card/20 overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-white/[0.04]"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-semibold">{t("settlementHistory")}</span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && (
        <div className="border-t border-white/[0.06] divide-y divide-white/[0.06]">
          {settlements.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">—</div>
          ) : (
            settlements.map((s, index) => {
              const id = String(s.id ?? "");
              const isEx = expanded === id;
              const settledAt = String(s.settledAt ?? "");
              const settledMs = settledAt ? Date.parse(settledAt) : NaN;
              const canUndo = index === 0 && !Number.isNaN(settledMs) && now > 0 && now - settledMs < 24 * 60 * 60 * 1000;
              return (
                <div key={id} className="p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-mono text-xs text-muted-foreground">{String(s.settledAt ?? "").slice(0, 19)}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {String(s.periodStart ?? "").slice(0, 10)} → {String(s.periodEnd ?? "").slice(0, 10)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums">{formatPrice(Number(s.transferAmount ?? 0))}</span>
                      {canUndo && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg" onClick={() => void undo(id)} title={t("undoSettlement")}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mt-2 text-xs text-primary hover:underline"
                    onClick={() => setExpanded(isEx ? null : id)}
                  >
                    {t("snapshotJson")}
                  </button>
                  {isEx && (
                    <pre className={cn("mt-2 max-h-48 overflow-auto rounded-lg bg-black/40 p-2 text-[10px] leading-relaxed")}>
                      {JSON.stringify(s.snapshot ?? {}, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
