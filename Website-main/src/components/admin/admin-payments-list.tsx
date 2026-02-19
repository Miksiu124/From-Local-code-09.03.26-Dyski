"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle,
  XCircle,
  Clock,
  CreditCard,
  User,
  Hash,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Bitcoin,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatPrice } from "@/lib/utils";
import { logger } from "@/lib/logger";

interface PurchaseItem {
  id: string;
  userEmail: string;
  userName: string | null;
  packageName: string;
  credits: number;
  amount: number;
  paymentMethod: string;
  transactionCode: string;
  blikCode: string | null;
  cryptoCurrency: string | null;
  txId: string | null;
  status: string;
  paymentProofUrl: string | null;
  adminNotes: string | null;
  expirationTime: string;
  createdAt: string;
}

interface Props {
  purchases: PurchaseItem[];
  initialBlikEnabled: boolean;
}

function methodIcon(method: string) {
  switch (method) {
    case "BLIK":
      return <Wallet className="h-4 w-4" />;
    case "CRYPTO":
      return <Bitcoin className="h-4 w-4" />;
    default:
      return <CreditCard className="h-4 w-4" />;
  }
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(Math.abs(ms) / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (days > 0) return `${days}d ${hours}h ${mins}m ${secs}s`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function timeAgo(dateStr: string, now: number): string {
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 1000) return "0s ago";
  return `${formatDuration(diffMs)} ago`;
}

function timeLeft(expirationTime: string, now: number): string {
  const exp = new Date(expirationTime).getTime();
  const diffMs = exp - now;
  if (diffMs <= 0) return "expired";
  return `${formatDuration(diffMs)} left`;
}

export function AdminPaymentsList({ purchases, initialBlikEnabled }: Props) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [items, setItems] = useState<PurchaseItem[]>(purchases);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseItem | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [blikEnabled, setBlikEnabled] = useState(initialBlikEnabled);
  const [blikSaving, setBlikSaving] = useState(false);
  const [now, setNow] = useState(Date.now());
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setItems(purchases);
  }, [purchases]);

  // Tick every second so time displays stay accurate
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // SSE: real-time stream from Go backend via Redis pub/sub
  useEffect(() => {
    const es = new EventSource("/api/admin/credits/purchases/stream");
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.event === "new_purchase") {
          const newItem: PurchaseItem = {
            id: data.id,
            userEmail: data.user?.email ?? "—",
            userName: data.user?.name ?? null,
            packageName: data.creditPackage?.name ?? "—",
            credits: data.credits ?? 0,
            amount: data.amount ?? 0,
            paymentMethod: data.paymentMethod ?? "",
            transactionCode: data.transactionCode ?? "",
            blikCode: data.blikCode ?? null,
            cryptoCurrency: data.cryptoCurrency ?? null,
            txId: null,
            status: "PENDING",
            paymentProofUrl: null,
            adminNotes: null,
            expirationTime: data.expirationTime ?? "",
            createdAt: data.createdAt ?? new Date().toISOString(),
          };
          setItems((prev) => {
            if (prev.some((p) => p.id === newItem.id)) return prev;
            return [newItem, ...prev];
          });
        }

        if (data.event === "blik_code_updated") {
          setItems((prev) =>
            prev.map((p) =>
              p.id === data.id
                ? { ...p, blikCode: data.blikCode, expirationTime: data.expirationTime ?? p.expirationTime }
                : p
            )
          );
        }
      } catch {
        // ignore parse errors on keepalive comments
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects, no action needed
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  const handleAction = async (id: string, action: "approve" | "reject") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/credits/purchases/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((p) => p.id !== id));
        setSelectedPurchase(null);
        setNotes("");
        router.refresh();
      }
    } catch (error) {
      logger.error("Failed to update purchase status", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleBlik = async () => {
    setBlikSaving(true);
    const newValue = !blikEnabled;
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          settings: [{ key: "blik_enabled", value: newValue }],
        }),
      });
      if (res.ok) {
        setBlikEnabled(newValue);
      }
    } catch (error) {
      logger.error("Failed to toggle BLIK", error);
    } finally {
      setBlikSaving(false);
    }
  };

  return (
    <>
      {/* BLIK Shop Toggle */}
      <Card
        className={`mb-8 border-2 transition-colors ${
          blikEnabled ? "border-green-500/30" : "border-red-500/30"
        }`}
      >
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {blikEnabled ? (
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/10">
                  <ShieldCheck className="h-6 w-6 text-green-500" />
                </div>
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10">
                  <ShieldAlert className="h-6 w-6 text-red-500" />
                </div>
              )}
              <div>
                <h3 className="text-lg font-semibold">
                  BLIK Shop {blikEnabled ? "Open" : "Closed"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {blikEnabled
                    ? "Users can create BLIK payments. Toggle off to temporarily disable."
                    : "BLIK payments are disabled. Users cannot use BLIK until you re-enable it."}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleBlik}
              disabled={blikSaving}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                blikEnabled ? "bg-green-500" : "bg-red-500/70"
              }`}
            >
              {blikSaving ? (
                <Loader2 className="h-5 w-5 text-white animate-spin mx-auto" />
              ) : (
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                    blikEnabled ? "translate-x-7" : "translate-x-1"
                  }`}
                />
              )}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Pending Purchases Tiles */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <CheckCircle className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-lg font-medium">No pending purchases</p>
          <p className="text-sm">New purchases will appear here instantly.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {items.map((p) => (
              <motion.div
                key={p.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                transition={{ duration: 0.3 }}
              >
                <Card className="border-warning/20 hover:border-warning/40 transition-colors h-full">
                  <CardContent className="p-5 flex flex-col h-full">
                    {/* Header: user + time */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/10">
                          <User className="h-5 w-5 text-warning" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold truncate">
                            {p.userName || p.userEmail}
                          </p>
                          {p.userName && (
                            <p className="text-xs text-muted-foreground truncate">
                              {p.userEmail}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {timeAgo(p.createdAt, now)}
                        </p>
                        <p className="text-xs text-warning font-medium tabular-nums">
                          <Clock className="h-3 w-3 inline mr-0.5" />
                          {timeLeft(p.expirationTime, now)}
                        </p>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="space-y-2 mb-4 flex-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Package</span>
                        <span className="font-medium">{p.packageName}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Amount</span>
                        <span className="font-bold text-lg">
                          {formatPrice(p.amount)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Method</span>
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          {methodIcon(p.paymentMethod)}
                          {p.paymentMethod}
                          {p.cryptoCurrency && (
                            <span className="text-muted-foreground">
                              ({p.cryptoCurrency})
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Code</span>
                        <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                          <Hash className="h-3 w-3 inline mr-0.5" />
                          {p.paymentMethod === "BLIK" && p.blikCode
                            ? p.blikCode
                            : p.transactionCode}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-3 border-t border-border">
                      <Button
                        className="flex-1"
                        variant="success"
                        size="sm"
                        onClick={() => handleAction(p.id, "approve")}
                        disabled={loading}
                      >
                        <CheckCircle className="h-4 w-4 mr-1.5" />
                        {t("approve")}
                      </Button>
                      <Button
                        className="flex-1"
                        variant="destructive"
                        size="sm"
                        onClick={() => handleAction(p.id, "reject")}
                        disabled={loading}
                      >
                        <XCircle className="h-4 w-4 mr-1.5" />
                        {t("reject")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedPurchase(p);
                          setNotes(p.adminNotes || "");
                        }}
                        className="px-2"
                      >
                        Details
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Detail Modal */}
      {selectedPurchase && (
        <Dialog
          open={!!selectedPurchase}
          onOpenChange={() => setSelectedPurchase(null)}
        >
          <DialogHeader>
            <DialogTitle>Purchase Details</DialogTitle>
            <DialogDescription>
              Transaction: {selectedPurchase.transactionCode}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">User</p>
                <p className="font-medium">{selectedPurchase.userEmail}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Package</p>
                <p className="font-medium">{selectedPurchase.packageName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Amount</p>
                <p className="font-medium">
                  {formatPrice(selectedPurchase.amount)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Credits</p>
                <p className="font-medium">{selectedPurchase.credits}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Method</p>
                <p className="font-medium">{selectedPurchase.paymentMethod}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Created</p>
                <p className="font-medium">
                  {new Date(selectedPurchase.createdAt).toLocaleString()}
                </p>
              </div>
              {selectedPurchase.blikCode && (
                <div>
                  <p className="text-muted-foreground">BLIK Code</p>
                  <p className="font-mono font-medium">
                    {selectedPurchase.blikCode}
                  </p>
                </div>
              )}
              {selectedPurchase.txId && (
                <div className="col-span-2">
                  <p className="text-muted-foreground">Transaction ID (TxID)</p>
                  <p className="font-mono text-xs break-all">
                    {selectedPurchase.txId}
                  </p>
                </div>
              )}
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-1">Admin Notes</p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-border bg-muted p-3 text-sm resize-none h-20"
                placeholder={t("addNotes")}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => handleAction(selectedPurchase.id, "reject")}
              disabled={loading}
            >
              <XCircle className="h-4 w-4 mr-2" />
              {t("reject")}
            </Button>
            <Button
              variant="success"
              onClick={() => handleAction(selectedPurchase.id, "approve")}
              disabled={loading}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {t("approve")}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </>
  );
}
