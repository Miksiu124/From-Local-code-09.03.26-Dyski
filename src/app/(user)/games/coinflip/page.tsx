"use client";

import { useEffect, useState } from "react";
import { Coins, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCredits } from "@/lib/utils";

type CoinflipRow = {
  id: string;
  betCredits: number;
  choice: "HEADS" | "TAILS";
  result: "HEADS" | "TAILS";
  won: boolean;
  payoutCredits: number;
  createdAt: string;
};

export default function CoinflipPage() {
  const [choice, setChoice] = useState<"HEADS" | "TAILS">("HEADS");
  const [betCredits, setBetCredits] = useState("20");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [history, setHistory] = useState<CoinflipRow[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const [histRes, meRes] = await Promise.all([
        fetch("/api/games/coinflip/history?limit=25", { credentials: "include" }),
        fetch("/api/auth/me", { credentials: "include" }),
      ]);
      if (histRes.ok) {
        const rows = (await histRes.json()) as CoinflipRow[];
        setHistory(Array.isArray(rows) ? rows : []);
      } else {
        setHistory([]);
      }
      if (meRes.ok) {
        const me = await meRes.json();
        setBalance(typeof me.creditBalance === "number" ? me.creditBalance : null);
      }
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const play = async () => {
    const bet = Number(betCredits);
    if (!Number.isFinite(bet)) return;
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/games/coinflip/play", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice, betCredits: bet }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatusMessage(data.message || data.error || "Coinflip failed");
        return;
      }
      setStatusMessage(
        data.won
          ? `Win! Result: ${data.result}. +${data.deltaCredits} credits`
          : `Loss. Result: ${data.result}. ${data.deltaCredits} credits`,
      );
      setBalance(data.creditBalance);
      await loadHistory();
      window.dispatchEvent(new CustomEvent("auth-change"));
    } catch {
      setStatusMessage("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Coinflip</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick heads or tails. Win pays 2x, loss takes your bet.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card/40 p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Current balance</span>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <Coins className="h-4 w-4 text-primary" />
            {balance == null ? "—" : formatCredits(balance)}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Choice</label>
            <div className="flex gap-2">
              <Button type="button" variant={choice === "HEADS" ? "default" : "outline"} onClick={() => setChoice("HEADS")}>
                HEADS
              </Button>
              <Button type="button" variant={choice === "TAILS" ? "default" : "outline"} onClick={() => setChoice("TAILS")}>
                TAILS
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Bet credits (5-500)</label>
            <input
              value={betCredits}
              onChange={(e) => setBetCredits(e.target.value.replace(/[^\d]/g, ""))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              inputMode="numeric"
            />
          </div>
        </div>
        <Button type="button" onClick={play} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
          Play coinflip
        </Button>
      </section>

      {statusMessage ? (
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm">{statusMessage}</div>
      ) : null}

      <section className="rounded-xl border border-border bg-card/30">
        <div className="border-b border-border px-4 py-3 text-sm font-medium">Recent rounds</div>
        {historyLoading ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : history.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No rounds yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {row.choice} vs {row.result} {row.won ? "· Win" : "· Loss"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Bet {row.betCredits} · {new Date(row.createdAt).toLocaleString()}
                  </p>
                </div>
                <span className={row.won ? "text-green-400 font-medium" : "text-red-400 font-medium"}>
                  {row.won ? `+${row.betCredits}` : `-${row.betCredits}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
