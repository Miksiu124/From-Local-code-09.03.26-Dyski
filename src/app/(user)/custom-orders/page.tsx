"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

type CustomOrderRow = {
  id: string;
  title: string;
  details: string;
  contact: string;
  budgetCredits?: number | null;
  status: string;
  adminNotes?: string;
  createdAt: string;
};

export default function CustomOrdersPage() {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [contact, setContact] = useState("");
  const [budgetCredits, setBudgetCredits] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [orders, setOrders] = useState<CustomOrderRow[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/custom-orders", { credentials: "include" });
      if (res.ok) {
        const rows = (await res.json()) as CustomOrderRow[];
        setOrders(Array.isArray(rows) ? rows : []);
      } else {
        setOrders([]);
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
        title,
        details,
        contact,
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
      setTitle("");
      setDetails("");
      setContact("");
      setBudgetCredits("");
      setStatusMessage("Custom order request submitted");
      await load();
    } catch {
      setStatusMessage("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Custom orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Submit what content you want, your rough budget, and contact details.
        </p>
      </div>

      <form onSubmit={submit} className="rounded-xl border border-border bg-card/40 p-4 sm:p-5 space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (e.g. Custom bundle with 4 creators)"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          required
          minLength={4}
          maxLength={120}
        />
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Describe what you want..."
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
        <Button type="submit" disabled={submitting} className="gap-2">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send request
        </Button>
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
                  {typeof row.budgetCredits === "number" ? (
                    <span className="text-xs text-muted-foreground">Budget: {row.budgetCredits} credits</span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{row.details}</p>
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
