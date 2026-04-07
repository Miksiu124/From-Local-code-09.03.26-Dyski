"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepTransitionRow = {
  from: string;
  to: string;
  usersWithFrom: number;
  usersWithBoth: number;
  conversionRate?: number;
  elapsedSeconds?: {
    sampleSize: number;
    p25?: number;
    p50?: number;
    p75?: number;
    p90?: number;
  };
};

function fmtDurationSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 90) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} h`;
  return `${(sec / 86400).toFixed(1)} d`;
}

function fmtPct(rate: number | undefined): string {
  if (rate == null || Number.isNaN(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

function TimeDistributionBar({
  p25,
  p50,
  p75,
  p90,
  reduceMotion,
}: {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  reduceMotion: boolean;
}) {
  const span = Math.max(p90 * 1.05, p75, p50, 1);
  const q25 = Math.min(100, (p25 / span) * 100);
  const q75 = Math.min(100, (p75 / span) * 100);
  const q50 = Math.min(100, (p50 / span) * 100);
  const bandLeft = q25;
  const bandW = Math.max(q75 - q25, 1.5);

  return (
    <div className="space-y-1">
      <div className="relative h-6 rounded-md bg-white/[0.05] ring-1 ring-white/[0.06] overflow-hidden">
        <motion.div
          className="absolute top-0 bottom-0 rounded-sm bg-violet-500/35"
          style={{ left: `${bandLeft}%`, width: `${bandW}%` }}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 200, damping: 26, mass: 0.7 }
          }
        />
        <motion.div
          className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_10px_rgba(124,58,237,0.65)]"
          style={{ left: `calc(${q50}% - 1px)` }}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={
            reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 280, damping: 22, delay: 0.08 }
          }
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground/90 tabular-nums">
        <span>p25 {fmtDurationSeconds(p25)}</span>
        <span>p75 {fmtDurationSeconds(p75)}</span>
      </div>
    </div>
  );
}

function JourneyEdge({
  row,
  index,
  onDrillTo,
  labels,
}: {
  row: StepTransitionRow;
  index: number;
  onDrillTo: (eventName: string) => void;
  labels: {
    conversion: string;
    users: string;
    medianTime: string;
    timeSpread: string;
    tapDrill: string;
  };
}) {
  const reduceMotion = useReducedMotion();
  const rate = row.conversionRate;
  const pct = rate == null || Number.isNaN(rate) ? 0 : Math.min(100, Math.max(0, rate * 100));
  const elapsed = row.elapsedSeconds;
  const hasTiming =
    elapsed &&
    typeof elapsed.p25 === "number" &&
    typeof elapsed.p50 === "number" &&
    typeof elapsed.p75 === "number" &&
    typeof elapsed.p90 === "number";

  const interactive = row.usersWithFrom > 0;

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 180, damping: 28, delay: index * 0.06 }
      }
      className="min-w-0 flex-1"
    >
      <button
        type="button"
        disabled={!interactive}
        onClick={() => interactive && onDrillTo(row.to)}
        title={interactive ? labels.tapDrill : undefined}
        className={cn(
          "w-full rounded-xl border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-transparent p-4 text-left transition-colors",
          interactive && "hover:border-primary/35 hover:bg-primary/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer",
          !interactive && "cursor-default opacity-80",
        )}
      >
        <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground uppercase tracking-wide">
          <span className="truncate">{row.from}</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary/80" aria-hidden />
          <span className="truncate text-foreground/90">{row.to}</span>
        </div>

        <div className="mt-3 h-2.5 rounded-full bg-white/[0.07] overflow-hidden ring-1 ring-white/[0.05]">
          <motion.div
            className="h-full w-full rounded-full bg-gradient-to-r from-emerald-500/90 via-primary to-violet-500/85"
            initial={reduceMotion ? false : { scaleX: 0 }}
            animate={{ scaleX: pct / 100 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 100, damping: 22, mass: 0.9, delay: 0.05 + index * 0.04 }
            }
            style={{ transformOrigin: "0% 50%" }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-2xl font-semibold tabular-nums tracking-tight">{fmtPct(rate)}</span>
          <span className="text-[11px] text-muted-foreground">
            {labels.users}:{" "}
            <span className="font-mono text-foreground/90">
              {row.usersWithBoth}/{row.usersWithFrom}
            </span>
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">{labels.conversion}</p>

        {hasTiming && (
          <div className="mt-4 pt-3 border-t border-white/[0.06] space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Timer className="h-3.5 w-3.5 text-violet-400/90 shrink-0" aria-hidden />
              <span>
                {labels.medianTime}:{" "}
                <span className="font-mono text-foreground">{fmtDurationSeconds(elapsed.p50!)}</span>
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">{labels.timeSpread}</p>
            <TimeDistributionBar
              p25={elapsed.p25!}
              p50={elapsed.p50!}
              p75={elapsed.p75!}
              p90={elapsed.p90!}
              reduceMotion={!!reduceMotion}
            />
          </div>
        )}
      </button>
    </motion.div>
  );
}

export function FunnelUserJourney({
  transitions,
  onDrillToEvent,
  t,
}: {
  transitions: StepTransitionRow[];
  onDrillToEvent: (eventName: string) => void;
  t: (key: string) => string;
}) {
  const labels = useMemo(
    () => ({
      conversion: t("growthFunnelUserJourneyConversion"),
      users: t("growthFunnelUserJourneyUsers"),
      medianTime: t("growthFunnelUserJourneyMedian"),
      timeSpread: t("growthFunnelUserJourneySpread"),
      tapDrill: t("growthFunnelUserJourneyTapDrill"),
    }),
    [t],
  );

  if (!transitions.length) return null;

  return (
    <div className="rounded-xl border border-white/[0.07] bg-muted/15 overflow-hidden">
      <div className="border-b border-white/[0.06] px-4 py-3 bg-gradient-to-r from-violet-600/[0.12] via-transparent to-emerald-600/[0.08]">
        <h3 className="text-sm font-semibold tracking-tight">{t("growthFunnelUserJourneyTitle")}</h3>
        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed max-w-3xl">
          {t("growthFunnelUserJourneyFootnote")}
        </p>
      </div>
      <div className="p-4 lg:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-3">
          {transitions.map((row, i) => (
            <JourneyEdge key={`${row.from}-${row.to}`} row={row} index={i} onDrillTo={onDrillToEvent} labels={labels} />
          ))}
        </div>
      </div>
    </div>
  );
}
