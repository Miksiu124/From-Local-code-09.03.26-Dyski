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
  const [coinFace, setCoinFace] = useState<"HEADS" | "TAILS">("HEADS");
  const [spinning, setSpinning] = useState(false);
  const [roundResult, setRoundResult] = useState<"HEADS" | "TAILS" | null>(null);

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
    setSpinning(true);
    setStatusMessage(null);
    setRoundResult(null);
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
        setSpinning(false);
        return;
      }
      const finalFace: "HEADS" | "TAILS" = data.result === "TAILS" ? "TAILS" : "HEADS";
      setTimeout(() => {
        setCoinFace(finalFace);
        setRoundResult(finalFace);
        setSpinning(false);
      }, 900);
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
      setSpinning(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Coinflip</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick heads or tails. Win pays 2x, loss takes your bet.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card/40 p-4 sm:p-5">
        <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
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
            <Button type="button" onClick={play} disabled={loading || spinning} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
              Play coinflip
            </Button>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/60 p-4">
            <p className="text-xs text-muted-foreground">Coin</p>
            <div className="mt-3 flex flex-col items-center gap-3">
              <div className="coinflip-stage">
                <div className={`coinflip-coin ${spinning ? "is-spinning" : ""} ${coinFace === "TAILS" ? "is-tails" : ""}`}>
                  <div className="coinflip-face coinflip-heads">H</div>
                  <div className="coinflip-face coinflip-tails">T</div>
                </div>
              </div>
              <p className="text-sm font-medium">
                {spinning ? "Spinning..." : roundResult ? `Result: ${roundResult}` : "Ready"}
              </p>
            </div>
          </div>
        </div>
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
      <style jsx>{`
        .coinflip-stage {
          perspective: 1000px;
          width: 132px;
          height: 132px;
          display: grid;
          place-items: center;
        }
        .coinflip-coin {
          position: relative;
          width: 112px;
          height: 112px;
          transform-style: preserve-3d;
          transition: transform 700ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .coinflip-coin.is-tails {
          transform: rotateY(180deg);
        }
        .coinflip-coin.is-spinning {
          animation: coinflip-spin 900ms cubic-bezier(0.22, 1, 0.36, 1) 1;
        }
        .coinflip-face {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          border-radius: 999px;
          border: 1px solid color-mix(in oklch, var(--color-border) 75%, transparent);
          font-size: 1.9rem;
          font-weight: 800;
          backface-visibility: hidden;
        }
        .coinflip-heads {
          background: color-mix(in oklch, var(--color-primary) 36%, var(--color-card));
          color: var(--color-primary-foreground);
        }
        .coinflip-tails {
          background: color-mix(in oklch, var(--color-muted) 62%, var(--color-card));
          color: var(--color-foreground);
          transform: rotateY(180deg);
        }
        @keyframes coinflip-spin {
          0% { transform: rotateY(0deg); }
          100% { transform: rotateY(1080deg); }
        }
      `}</style>
    </div>
  );
}
