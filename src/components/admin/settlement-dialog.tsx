"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { formatPrice } from "@/lib/utils";
import type { StatsPayload } from "@/components/admin/payments-dashboard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function SettlementDialog({
  open,
  onOpenChange,
  statsSince,
  onSettled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  statsSince: StatsPayload;
  onSettled: () => void;
}) {
  const t = useTranslations("admin.payments");
  const tCommon = useTranslations("common");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const split = (statsSince && typeof statsSince === "object" ? (statsSince as { split?: Record<string, unknown> }).split : undefined) ?? {};
  const owed = Number(split.owedToMe ?? 0);
  const my = Number(split.myCollected ?? 0);
  const partner = Number(split.partnerCollected ?? 0);

  const submit = async () => {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/revenue/settle", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string; Message?: string; error?: string; Error?: string } | null;
        setErr(j?.Message ?? j?.message ?? j?.Error ?? j?.error ?? `HTTP ${res.status}`);
        return;
      }
      onOpenChange(false);
      setNotes("");
      onSettled();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border border-white/[0.1] bg-card">
        <DialogHeader>
          <DialogTitle>{t("settleNow")}</DialogTitle>
          <DialogDescription>{t("settlementPreview")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/[0.08] p-3 bg-black/20">
            <span className="text-muted-foreground">{t("mySplit")}</span>
            <span className="font-semibold tabular-nums">{formatPrice(my)}</span>
            <span className="text-muted-foreground">{t("partnerSplit")}</span>
            <span className="font-semibold tabular-nums">{formatPrice(partner)}</span>
            <span className="text-muted-foreground col-span-2 pt-1">Net (50/50)</span>
            <span className="col-span-2 font-medium">
              {Math.abs(owed) < 0.01
                ? t("evenSplit")
                : owed > 0
                  ? t("transferPositive", { amount: formatPrice(owed) })
                  : t("transferNegative", { amount: formatPrice(Math.abs(owed)) })}
            </span>
          </div>
          <label className="block text-xs text-muted-foreground">
            {t("settlementNotes")}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full min-h-[72px] rounded-xl border border-white/[0.1] bg-black/30 p-2 text-sm"
            />
          </label>
          {err && <p className="text-xs text-rose-400">{err}</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" className="rounded-xl" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button className="rounded-xl" disabled={loading} onClick={() => void submit()}>
            {loading ? "…" : t("settlementConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
