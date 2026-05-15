"use client";

import { type CSSProperties, useEffect, useState } from "react";
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
  const [mode, setMode] = useState<"MANUAL" | "AUTO">("MANUAL");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [history, setHistory] = useState<CoinflipRow[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [coinFace, setCoinFace] = useState<"HEADS" | "TAILS">("HEADS");
  const [spinning, setSpinning] = useState(false);
  const [roundResult, setRoundResult] = useState<"HEADS" | "TAILS" | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [spinConfig, setSpinConfig] = useState({
    startYDeg: 0,
    midYDeg: 720,
    endYDeg: 1440,
    tiltDeg: 14,
    durationMs: 1150,
  });

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

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  const play = async () => {
    const bet = Number(betCredits);
    if (!Number.isFinite(bet)) return;
    setLoading(true);
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
        return;
      }
      const finalFace: "HEADS" | "TAILS" = data.result === "TAILS" ? "TAILS" : "HEADS";
      const currentYDeg = coinFace === "TAILS" ? 180 : 0;
      const targetYDeg = finalFace === "TAILS" ? 180 : 0;
      const deltaToTarget = ((targetYDeg - currentYDeg) % 360 + 360) % 360;
      const extraTurns = reduceMotion ? 1 : 5 + Math.floor(Math.random() * 2);
      const endYDeg = currentYDeg + extraTurns * 360 + deltaToTarget;
      const midYDeg = currentYDeg + Math.round((endYDeg - currentYDeg) * 0.56);
      const durationMs = reduceMotion ? 140 : 1150;

      setSpinConfig({
        startYDeg: currentYDeg,
        midYDeg,
        endYDeg,
        tiltDeg: reduceMotion ? 0 : 14,
        durationMs,
      });
      setSpinning(true);

      setTimeout(() => {
        setCoinFace(finalFace);
        setRoundResult(finalFace);
        setSpinning(false);
      }, durationMs);
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

  const setHalfBet = () => {
    const next = Math.max(5, Math.floor((Number(betCredits) || 0) / 2));
    setBetCredits(String(next));
  };

  const setDoubleBet = () => {
    const next = Math.min(500, Math.max(5, (Number(betCredits) || 0) * 2));
    setBetCredits(String(next));
  };

  const randomPick = () => {
    setChoice(Math.random() > 0.5 ? "HEADS" : "TAILS");
  };

  return (
    <div className="coinflip-page container mx-auto max-w-6xl px-4 py-8 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Coinflip</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick heads or tails, win pays 2x.
        </p>
      </div>

      <section className="coinflip-shell rounded-xl border border-border bg-card/40 p-3 sm:p-4">
        <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="coinflip-control rounded-lg border border-border/80 bg-background/55 p-3 space-y-3">
            <div className="coinflip-mode">
              <button
                type="button"
                className={mode === "MANUAL" ? "is-active" : ""}
                onClick={() => setMode("MANUAL")}
              >
                Manual
              </button>
              <button
                type="button"
                className={mode === "AUTO" ? "is-active" : ""}
                onClick={() => setMode("AUTO")}
              >
                Auto
              </button>
            </div>
            <div>
              <div className="coinflip-row-label">
                <span>Current balance</span>
                <strong className="inline-flex items-center gap-1">
                  <Coins className="h-3.5 w-3.5 text-primary" />
                  {balance == null ? "—" : formatCredits(balance)}
                </strong>
              </div>
            </div>
            <div>
              <label className="coinflip-row-label">Bet amount</label>
              <div className="coinflip-bet-input">
                <input
                  value={betCredits}
                  onChange={(e) => setBetCredits(e.target.value.replace(/[^\d]/g, ""))}
                  inputMode="numeric"
                  aria-label="Bet credits"
                />
                <button type="button" onClick={setHalfBet}>
                  1/2x
                </button>
                <button type="button" onClick={setDoubleBet}>
                  2x
                </button>
              </div>
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={randomPick}>
              Random pick
            </Button>
            <div className="coinflip-choice">
              <button
                type="button"
                className={choice === "HEADS" ? "is-active" : ""}
                onClick={() => setChoice("HEADS")}
              >
                Heads
              </button>
              <button
                type="button"
                className={choice === "TAILS" ? "is-active" : ""}
                onClick={() => setChoice("TAILS")}
              >
                Tails
              </button>
            </div>
            <Button
              type="button"
              onClick={play}
              disabled={loading || spinning || mode === "AUTO"}
              className="coinflip-bet-btn gap-2"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
              {mode === "AUTO" ? "Auto mode soon" : "Bet"}
            </Button>
          </aside>

          <div className="coinflip-arena rounded-lg border border-border/80 bg-background/45 p-4 sm:p-5">
            <div className="coinflip-arena-core">
              <div className="coinflip-stage">
                <div
                  className={`coinflip-coin ${spinning ? "is-spinning" : ""} ${coinFace === "TAILS" ? "is-tails" : ""} ${reduceMotion ? "is-reduced" : ""}`}
                  aria-label={`Coin side ${coinFace}`}
                  style={
                    {
                      "--coin-start-y": `${spinConfig.startYDeg}deg`,
                      "--coin-mid-y": `${spinConfig.midYDeg}deg`,
                      "--coin-end-y": `${spinConfig.endYDeg}deg`,
                      "--coin-tilt": `${spinConfig.tiltDeg}deg`,
                      "--coin-spin-duration": `${spinConfig.durationMs}ms`,
                    } as CSSProperties
                  }
                >
                  <div className="coinflip-face coinflip-heads">H</div>
                  <div className="coinflip-face coinflip-tails">◯</div>
                </div>
              </div>
            </div>
            <div className="coinflip-mini-history">
              <p className="coinflip-row-label">History</p>
              <div className="coinflip-mini-strip">
                {history.slice(0, 22).map((row) => (
                  <span
                    key={row.id}
                    className={`coinflip-mini-chip ${row.won ? "is-win" : "is-loss"}`}
                    title={`${row.choice} vs ${row.result} · ${row.won ? "Win" : "Loss"}`}
                  >
                    {row.result === "HEADS" ? "H" : "T"}
                  </span>
                ))}
                {history.length === 0 ? <span className="text-xs text-muted-foreground">No rounds yet.</span> : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      {statusMessage ? (
        <div className="coinflip-status rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm">{statusMessage}</div>
      ) : null}

      <section className="coinflip-panel rounded-xl border border-border bg-card/30">
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
              <li key={row.id} className="coinflip-history-item flex items-center justify-between gap-3 px-4 py-3 text-sm">
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
        .coinflip-page {
          position: relative;
        }
        .coinflip-shell {
          background: color-mix(in oklch, var(--color-card) 70%, transparent);
        }
        .coinflip-control {
          background: color-mix(in oklch, var(--color-background) 85%, transparent);
        }
        .coinflip-mode {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.35rem;
          background: color-mix(in oklch, var(--color-muted) 50%, transparent);
          border-radius: 10px;
          padding: 0.2rem;
        }
        .coinflip-mode button,
        .coinflip-choice button {
          border: 0;
          border-radius: 8px;
          padding: 0.5rem 0.7rem;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--color-muted-foreground);
          background: transparent;
          transition: background-color 130ms ease, color 130ms ease;
        }
        .coinflip-mode button.is-active,
        .coinflip-choice button.is-active {
          color: var(--color-foreground);
          background: color-mix(in oklch, var(--color-card) 80%, transparent);
        }
        .coinflip-row-label {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.75rem;
          color: var(--color-muted-foreground);
          margin-bottom: 0.35rem;
        }
        .coinflip-bet-input {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 0.35rem;
        }
        .coinflip-bet-input input {
          width: 100%;
          min-width: 0;
          border: 1px solid var(--color-border);
          border-radius: 8px;
          background: color-mix(in oklch, var(--color-background) 88%, transparent);
          padding: 0.5rem 0.6rem;
          font-size: 0.9rem;
        }
        .coinflip-bet-input button {
          border: 1px solid var(--color-border);
          border-radius: 8px;
          background: color-mix(in oklch, var(--color-muted) 40%, transparent);
          color: var(--color-foreground);
          padding: 0.5rem 0.6rem;
          font-size: 0.75rem;
          font-weight: 600;
        }
        .coinflip-choice {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.35rem;
        }
        .coinflip-bet-btn {
          width: 100%;
          background: #18dc38;
          color: #06210c;
          border: 1px solid #15bf31;
        }
        .coinflip-bet-btn:hover:enabled {
          filter: brightness(1.03);
        }
        .coinflip-arena {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 1rem;
          min-height: 420px;
          background: color-mix(in oklch, var(--color-background) 76%, transparent);
        }
        .coinflip-arena-core {
          flex: 1;
          min-height: 0;
          display: grid;
          place-items: center;
        }
        .coinflip-stage {
          perspective: 1000px;
          width: min(54vw, 300px);
          height: min(54vw, 300px);
          display: grid;
          place-items: center;
          position: relative;
        }
        .coinflip-coin {
          position: relative;
          width: min(48vw, 260px);
          height: min(48vw, 260px);
          transform-style: preserve-3d;
          transform: rotateY(var(--coin-rest-y, 0deg));
          transition: transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .coinflip-coin.is-tails {
          --coin-rest-y: 180deg;
        }
        .coinflip-coin.is-spinning {
          animation: coinflip-spin-flight var(--coin-spin-duration) cubic-bezier(0.2, 0.82, 0.2, 1) 1 forwards;
          will-change: transform;
        }
        .coinflip-coin.is-spinning.is-reduced {
          animation-duration: 140ms;
        }
        .coinflip-face {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          border-radius: 999px;
          border: 2px solid color-mix(in oklch, var(--color-border) 72%, transparent);
          font-size: clamp(2.2rem, 8vw, 3.6rem);
          font-weight: 800;
          backface-visibility: hidden;
        }
        .coinflip-heads {
          background: color-mix(in oklch, var(--color-primary) 40%, var(--color-card));
          color: color-mix(in oklch, var(--color-background) 80%, black);
        }
        .coinflip-tails {
          background: color-mix(in oklch, #f3ab0f 85%, var(--color-card));
          color: #3b2803;
          border: 14px solid color-mix(in oklch, #f3ab0f 96%, white 4%);
          transform: rotateY(180deg);
        }
        .coinflip-mini-history {
          border-top: 1px solid color-mix(in oklch, var(--color-border) 75%, transparent);
          padding-top: 0.8rem;
        }
        .coinflip-mini-strip {
          border-radius: 8px;
          border: 1px solid var(--color-border);
          background: color-mix(in oklch, var(--color-background) 92%, transparent);
          min-height: 42px;
          padding: 0.35rem;
          display: flex;
          flex-wrap: nowrap;
          gap: 0.3rem;
          overflow-x: auto;
          align-items: center;
        }
        .coinflip-mini-chip {
          flex: 0 0 auto;
          width: 24px;
          height: 24px;
          border-radius: 7px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.72rem;
          font-weight: 700;
          border: 1px solid var(--color-border);
        }
        .coinflip-mini-chip.is-win {
          color: #9df4ad;
          background: color-mix(in oklch, #1f9a32 40%, transparent);
        }
        .coinflip-mini-chip.is-loss {
          color: #f2a2a9;
          background: color-mix(in oklch, #a93540 40%, transparent);
        }
        .coinflip-status {
          animation: coinflip-status-in 180ms ease-out;
        }
        .coinflip-history-item {
          transition: background-color 180ms ease;
        }
        .coinflip-history-item:hover {
          background: color-mix(in oklch, var(--color-muted) 32%, transparent);
        }
        @keyframes coinflip-spin-flight {
          0% { transform: rotateX(0deg) rotateY(var(--coin-start-y)); }
          56% { transform: rotateX(var(--coin-tilt)) rotateY(var(--coin-mid-y)); }
          100% { transform: rotateX(0deg) rotateY(var(--coin-end-y)); }
        }
        @keyframes coinflip-status-in {
          0% { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .coinflip-status {
            animation: none !important;
            opacity: 1;
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}
