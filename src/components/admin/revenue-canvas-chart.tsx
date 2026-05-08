"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "framer-motion";
import type { StatsPayload } from "@/components/admin/payments-dashboard";

type TsRow = {
  bucket: string;
  totalAmount: number;
  perMethod?: Record<string, { totalAmount?: number }>;
};

function parseTimeseries(stats: StatsPayload): TsRow[] {
  if (!stats || typeof stats !== "object") return [];
  const ts = (stats as { timeseries?: unknown }).timeseries;
  if (!Array.isArray(ts)) return [];
  return ts.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      bucket: String(r.bucket ?? ""),
      totalAmount: Number(r.totalAmount ?? 0),
      perMethod: (r.perMethod as Record<string, { totalAmount?: number }>) ?? {},
    };
  });
}

export function RevenueCanvasChart({ stats }: { stats: StatsPayload }) {
  const t = useTranslations("admin.payments");
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: 220 });
  const [brush, setBrush] = useState<{ a: number; b: number } | null>(null);
  const dragRef = useRef<{ active: boolean; startX: number } | null>(null);
  const [visible, setVisible] = useState(true);

  const series = useMemo(() => parseTimeseries(stats), [stats]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => setVisible(e.isIntersecting),
      { rootMargin: "80px", threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(320, Math.floor(r.width)), h: 220 });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: Math.max(320, Math.floor(r.width)), h: 220 });
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) return;
    const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
    const { w, h } = size;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 44, r: 12, t: 16, b: 28 };
    const innerW = w - pad.l - pad.r;
    const innerH = h - pad.t - pad.b;
    if (series.length === 0) {
      ctx.fillStyle = "rgba(148,163,184,0.35)";
      ctx.font = "13px system-ui";
      ctx.fillText("—", pad.l, pad.t + 40);
      return;
    }

    let maxY = 1;
    for (const row of series) {
      maxY = Math.max(maxY, row.totalAmount);
    }

    const n = series.length;
    const xAt = (i: number) => pad.l + (innerW * (n === 1 ? 0.5 : i / (n - 1)));

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = pad.t + (innerH * g) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + innerW, y);
      ctx.stroke();
    }

    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + innerH);
    grad.addColorStop(0, "rgba(139,92,246,0.35)");
    grad.addColorStop(1, "rgba(139,92,246,0.02)");
    ctx.beginPath();
    ctx.moveTo(xAt(0), pad.t + innerH);
    for (let i = 0; i < n; i++) {
      ctx.lineTo(xAt(i), pad.t + innerH - (series[i].totalAmount / maxY) * innerH);
    }
    ctx.lineTo(xAt(n - 1), pad.t + innerH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Total line
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = xAt(i);
      const y = pad.t + innerH - (series[i].totalAmount / maxY) * innerH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // brush overlay
    if (brush && brush.b !== brush.a) {
      const x1 = Math.min(brush.a, brush.b);
      const x2 = Math.max(brush.a, brush.b);
      ctx.fillStyle = "rgba(139,92,246,0.18)";
      ctx.fillRect(x1, pad.t, x2 - x1, innerH);
      ctx.strokeStyle = "rgba(139,92,246,0.6)";
      ctx.strokeRect(x1, pad.t, x2 - x1, innerH);
    }

    ctx.fillStyle = "rgba(148,163,184,0.8)";
    ctx.font = "10px system-ui";
    const step = Math.max(1, Math.floor(n / 6));
    for (let i = 0; i < n; i += step) {
      const label = series[i].bucket.slice(0, 16);
      ctx.fillText(label, xAt(i) - 20, h - 8);
    }
  }, [series, size, visible, brush]);

  useEffect(() => {
    draw();
  }, [draw]);

  const onPointerDown = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { active: true, startX: e.clientX - rect.left };
    setBrush({ a: dragRef.current.startX, b: dragRef.current.startX });
    canvasRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current?.active) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    setBrush({ a: dragRef.current.startX, b: x });
  };

  const commitBrush = () => {
    const b = brush;
    dragRef.current = null;
    if (!b || series.length === 0) {
      setBrush(null);
      return;
    }
    const x1 = Math.min(b.a, b.b);
    const x2 = Math.max(b.a, b.b);
    if (x2 - x1 < 8) {
      setBrush(null);
      return;
    }
    const padL = 44;
    const padR = 12;
    const innerW = size.w - padL - padR;
    const n = series.length;
    const i1 = Math.max(0, Math.min(n - 1, Math.floor(((x1 - padL) / innerW) * (n - 1))));
    const i2 = Math.max(0, Math.min(n - 1, Math.ceil(((x2 - padL) / innerW) * (n - 1))));
    const lo = Math.min(i1, i2);
    const hi = Math.max(i1, i2);
    const from = new Date(series[lo].bucket).toISOString();
    const to = new Date(series[hi].bucket).toISOString();
    const params = new URLSearchParams(window.location.search);
    params.set("from", from);
    params.set("to", to);
    router.replace(`?${params.toString()}`, { scroll: false });
    setBrush(null);
  };

  if (reduceMotion && series.length > 0) {
    const maxY = Math.max(1, ...series.map((s) => s.totalAmount));
    const pts = series.map((s, i, arr) => {
      const x = (i / Math.max(1, arr.length - 1)) * 100;
      const y = 100 - (s.totalAmount / maxY) * 100;
      return `${x},${y}`;
    });
    return (
      <section className="rounded-2xl border border-white/[0.08] p-4 bg-card/20" aria-label={t("ariaChart")}>
        <h2 className="text-sm font-semibold mb-2">{t("chartTitle")}</h2>
        <svg viewBox="0 0 100 100" className="w-full h-48 text-primary/80" preserveAspectRatio="none" role="img">
          <polyline fill="none" stroke="currentColor" strokeWidth="1.2" points={pts.join(" ")} />
        </svg>
        <p className="text-[11px] text-muted-foreground mt-2">{t("chartBrushHint")}</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] p-4 bg-card/20" aria-label={t("ariaChart")}>
      <h2 className="text-sm font-semibold mb-1">{t("chartTitle")}</h2>
      <p className="text-[11px] text-muted-foreground mb-2">{t("chartBrushHint")}</p>
      <div ref={wrapRef} className="w-full">
        <canvas
          ref={canvasRef}
          className="w-full touch-none cursor-crosshair rounded-lg bg-black/20"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={commitBrush}
          onPointerCancel={() => {
            dragRef.current = null;
            setBrush(null);
          }}
        />
      </div>
    </section>
  );
}
