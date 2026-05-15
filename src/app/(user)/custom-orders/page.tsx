"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader2, Send, Link as LinkIcon, Sparkles, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

type RequestScope = "MAIN_ONLY" | "MAIN_AND_PPV";
type RequestTarget = "PRIVATE_ONLY" | "PUBLISH_TO_SITE";

type CustomOrderRow = {
  id: string;
  title: string;
  details: string;
  contact: string;
  onlyFansLink: string;
  modelName: string;
  requestScope: RequestScope;
  requestTarget: RequestTarget;
  budgetCredits?: number | null;
  chargedCredits: number;
  chargedAt?: string | null;
  refundedAt?: string | null;
  status: string;
  adminNotes?: string;
  createdAt: string;
};

type PublicSettings = {
  custom_order_price_main_private?: number;
  custom_order_price_main_public?: number;
  custom_order_price_main_ppv_private?: number;
  custom_order_price_main_ppv_public?: number;
};

const DEFAULT_PRICING: Required<PublicSettings> = {
  custom_order_price_main_private: 250,
  custom_order_price_main_public: 450,
  custom_order_price_main_ppv_private: 400,
  custom_order_price_main_ppv_public: 650,
};

const formatScope = (scope: RequestScope) =>
  scope === "MAIN_AND_PPV" ? "Main + PPV" : "Main only";

const formatTarget = (target: RequestTarget) =>
  target === "PUBLISH_TO_SITE" ? "Publish to site" : "Private only";

export default function CustomOrdersPage() {
  const [onlyFansLink, setOnlyFansLink] = useState("");
  const [modelName, setModelName] = useState("");
  const [requestScope, setRequestScope] = useState<RequestScope>("MAIN_ONLY");
  const [requestTarget, setRequestTarget] = useState<RequestTarget>("PRIVATE_ONLY");
  const [details, setDetails] = useState("");
  const [contact, setContact] = useState("");
  const [budgetCredits, setBudgetCredits] = useState("");
  const [pricing, setPricing] = useState(DEFAULT_PRICING);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [orders, setOrders] = useState<CustomOrderRow[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [ordersRes, settingsRes, balanceRes] = await Promise.all([
        fetch("/api/custom-orders", { credentials: "include" }),
        fetch("/api/settings/public", { credentials: "include" }),
        fetch("/api/user/balance", { credentials: "include" }),
      ]);
      if (ordersRes.ok) {
        const rows = (await ordersRes.json()) as CustomOrderRow[];
        setOrders(Array.isArray(rows) ? rows : []);
      } else {
        setOrders([]);
      }
      if (settingsRes.ok) {
        const settings = (await settingsRes.json()) as PublicSettings;
        setPricing({
          custom_order_price_main_private:
            Number(settings.custom_order_price_main_private) || DEFAULT_PRICING.custom_order_price_main_private,
          custom_order_price_main_public:
            Number(settings.custom_order_price_main_public) || DEFAULT_PRICING.custom_order_price_main_public,
          custom_order_price_main_ppv_private:
            Number(settings.custom_order_price_main_ppv_private) || DEFAULT_PRICING.custom_order_price_main_ppv_private,
          custom_order_price_main_ppv_public:
            Number(settings.custom_order_price_main_ppv_public) || DEFAULT_PRICING.custom_order_price_main_ppv_public,
        });
      }
      if (balanceRes.ok) {
        const balanceData = (await balanceRes.json()) as { creditBalance?: number };
        setCreditBalance(typeof balanceData.creditBalance === "number" ? balanceData.creditBalance : null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setStatusMessage(null);
    try {
      const payload: Record<string, unknown> = {
        title: modelName ? `Custom ${modelName}` : "Custom order",
        details,
        contact,
        onlyFansLink,
        modelName,
        requestScope,
        requestTarget,
      };
      if (budgetCredits.trim() !== "") {
        payload.budgetCredits = Number(budgetCredits);
      }
      const res = await fetch("/api/custom-orders", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatusMessage(data.message || data.error || "Failed to submit custom order");
        return;
      }
      setOnlyFansLink("");
      setModelName("");
      setRequestScope("MAIN_ONLY");
      setRequestTarget("PRIVATE_ONLY");
      setDetails("");
      setContact("");
      setBudgetCredits("");
      const charged = typeof data.chargedCredits === "number" ? data.chargedCredits : selectedPrice;
      setStatusMessage(`Custom order submitted. ${charged} credits charged.`);
      await load();
    } catch {
      setStatusMessage("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedPrice =
    requestScope === "MAIN_AND_PPV"
      ? requestTarget === "PUBLISH_TO_SITE"
        ? pricing.custom_order_price_main_ppv_public
        : pricing.custom_order_price_main_ppv_private
      : requestTarget === "PUBLISH_TO_SITE"
        ? pricing.custom_order_price_main_public
        : pricing.custom_order_price_main_private;
  const projectedBalance =
    typeof creditBalance === "number" ? creditBalance - selectedPrice : null;
  const canAfford = projectedBalance === null || projectedBalance >= 0;

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Custom orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Submit an OF target, choose delivery mode, and pay instantly in credits.
        </p>
      </div>

      <form onSubmit={submit} className="rounded-2xl border border-border bg-card/40 p-4 sm:p-6 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              OF link
            </span>
            <div className="relative">
              <LinkIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                value={onlyFansLink}
                onChange={(e) => setOnlyFansLink(e.target.value)}
                placeholder="https://onlyfans.com/..."
                className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm"
                required
                maxLength={1000}
              />
            </div>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Model name
            </span>
            <input
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="Model nickname"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              required
              minLength={2}
              maxLength={120}
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Scope</p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={requestScope === "MAIN_ONLY" ? "default" : "outline"}
                onClick={() => setRequestScope("MAIN_ONLY")}
                className="justify-start"
              >
                Main only
              </Button>
              <Button
                type="button"
                variant={requestScope === "MAIN_AND_PPV" ? "default" : "outline"}
                onClick={() => setRequestScope("MAIN_AND_PPV")}
                className="justify-start"
              >
                Main + PPV
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Destination</p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={requestTarget === "PRIVATE_ONLY" ? "default" : "outline"}
                onClick={() => setRequestTarget("PRIVATE_ONLY")}
                className="justify-start"
              >
                Private only
              </Button>
              <Button
                type="button"
                variant={requestTarget === "PUBLISH_TO_SITE" ? "default" : "outline"}
                onClick={() => setRequestTarget("PUBLISH_TO_SITE")}
                className="justify-start"
              >
                Publish on site
              </Button>
            </div>
          </div>
        </div>

        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Describe exactly what should be included..."
          className="min-h-32 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          required
          minLength={12}
          maxLength={4000}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Contact (Discord / Telegram / email)"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            maxLength={180}
          />
          <input
            value={budgetCredits}
            onChange={(e) => setBudgetCredits(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="Budget (credits, optional)"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            inputMode="numeric"
          />
        </div>

        <div className="rounded-xl border border-border/70 bg-background/40 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-primary" />
              Live pricing
            </div>
            <span className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-sm font-semibold text-primary">
              {selectedPrice} credits
            </span>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {formatScope(requestScope)} · {formatTarget(requestTarget)}
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <span>
              Balance: {typeof creditBalance === "number" ? creditBalance : "—"} credits
            </span>
            {typeof projectedBalance === "number" ? (
              <span className={projectedBalance < 0 ? "text-destructive" : "text-emerald-500"}>
                → after submit: {projectedBalance}
              </span>
            ) : null}
          </div>
        </div>

        <Button type="submit" disabled={submitting || !canAfford} className="gap-2">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Submit and charge {selectedPrice} credits
        </Button>
        {!canAfford ? (
          <p className="text-sm text-destructive">Insufficient credits for this option. Top up first.</p>
        ) : null}
      </form>

      {statusMessage ? (
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm">{statusMessage}</div>
      ) : null}

      <section className="rounded-xl border border-border bg-card/30">
        <div className="border-b border-border px-4 py-3 text-sm font-medium">Your requests</div>
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : orders.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No custom order requests yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {orders.map((row) => (
              <li key={row.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{row.title}</span>
                  <span className="rounded-md border border-border px-2 py-0.5 text-xs">{row.status}</span>
                  <span className="text-xs text-primary">Charged: {row.chargedCredits} credits</span>
                  {typeof row.budgetCredits === "number" ? (
                    <span className="text-xs text-muted-foreground">Budget: {row.budgetCredits} credits</span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {row.modelName} · {formatScope(row.requestScope)} · {formatTarget(row.requestTarget)}
                </div>
                <p className="mt-1 text-xs text-muted-foreground break-all">{row.onlyFansLink}</p>
                <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{row.details}</p>
                {row.refundedAt ? (
                  <p className="mt-2 text-xs text-emerald-500">
                    Refunded automatically ({row.chargedCredits} credits)
                  </p>
                ) : null}
                {row.adminNotes ? (
                  <p className="mt-2 text-xs text-foreground/90">Admin notes: {row.adminNotes}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
