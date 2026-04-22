"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { getTimeRemaining } from "@/lib/utils";

interface PaymentCountdownProps {
  expirationTime: string;
  isBlik?: boolean;
  onBlikExpired?: (expired: boolean) => void;
}

export function PaymentCountdown({ expirationTime, isBlik, onBlikExpired }: PaymentCountdownProps) {
  /** null until layout — getTimeRemaining uses Date.now() and must not run during SSR/first client pass */
  const [time, setTime] = useState<ReturnType<typeof getTimeRemaining> | null>(null);
  const initialTotalRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const notifyExpired = useCallback((expired: boolean) => {
    onBlikExpired?.(expired);
  }, [onBlikExpired]);

  useLayoutEffect(() => {
    initialTotalRef.current = new Date(expirationTime).getTime() - Date.now();
    const newTime = getTimeRemaining(new Date(expirationTime));
    setTime(newTime);
    firedRef.current = false;
    if (!newTime.expired) {
      notifyExpired(false);
    }
  }, [expirationTime, notifyExpired]);

  useEffect(() => {
    const interval = setInterval(() => {
      const newTime = getTimeRemaining(new Date(expirationTime));
      setTime(newTime);

      if (newTime.expired && isBlik && !firedRef.current) {
        firedRef.current = true;
        notifyExpired(true);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expirationTime, isBlik, notifyExpired]);

  if (!time) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-1">Expires in</p>
          <div className="flex items-center justify-center gap-2 text-2xl font-mono font-bold text-muted-foreground/40">
            <span className="inline-block w-[4.5ch] tabular-nums animate-pulse">--:--</span>
          </div>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden" />
      </div>
    );
  }

  const initialTotal = initialTotalRef.current || 1;
  const progress = Math.max(0, Math.min(1, time.total / Math.max(initialTotal, 1)));

  if (time.expired) {
    return (
      <div className="text-center p-4 rounded-xl bg-destructive/10 border border-destructive/20">
        <p className="text-destructive font-semibold">
          {isBlik ? "BLIK code expired — enter a new code below" : "Expired"}
        </p>
      </div>
    );
  }

  const isWarning = time.total < 30000; // < 30 seconds

  return (
    <div className="space-y-3">
      <div className="text-center">
        <p className="text-sm text-muted-foreground mb-1">Expires in</p>
        <div className="flex items-center justify-center gap-2 text-2xl font-mono font-bold">
          {time.hours > 0 && (
            <>
              <span>{String(time.hours).padStart(2, "0")}</span>
              <span className="text-muted-foreground">:</span>
            </>
          )}
          <span>{String(time.minutes).padStart(2, "0")}</span>
          <span className="text-muted-foreground">:</span>
          <motion.span
            key={time.seconds}
            initial={{ opacity: 0.5, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={isWarning ? "text-destructive" : ""}
          >
            {String(time.seconds).padStart(2, "0")}
          </motion.span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${isWarning ? "bg-destructive" : "bg-primary"}`}
          initial={{ width: "100%" }}
          animate={{ width: `${progress * 100}%` }}
          transition={{ duration: 1, ease: "linear" }}
        />
      </div>
    </div>
  );
}
