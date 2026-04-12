"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  FileCheck,
  FileX,
  Link2,
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
import { PurchaseReferralSourceHover } from "@/components/admin/purchase-referral-source-hover";
import { parseReferralReferrer, type ReferralReferrer } from "@/lib/referral-referrer";

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
  fromCustomLink: boolean;
  customLinkSlug: string | null;
  fromUserReferral: boolean;
  /** Present when fromUserReferral — who shared the /r/ or ?ref= link */
  referralReferrer: ReferralReferrer | null;
}

function purchaseItemFromApi(p: Record<string, unknown>): PurchaseItem {
  const user = p.user as { email?: string; name?: string | null } | undefined;
  const pkg = p.creditPackage as { name?: string; credits?: number; price?: number } | undefined;
  return {
    id: String(p.id ?? ""),
    userEmail: user?.email ?? "—",
    userName: user?.name ?? null,
    packageName: pkg?.name ?? "—",
    credits: Number(p.credits ?? 0),
    amount: Number(p.amount ?? 0),
    paymentMethod: String(p.paymentMethod ?? ""),
    transactionCode: String(p.transactionCode ?? ""),
    blikCode: (p.blikCode as string | null | undefined) ?? null,
    cryptoCurrency: (p.cryptoCurrency as string | null | undefined) ?? null,
    txId: (p.txId as string | null | undefined) ?? null,
    status: String(p.status ?? "PENDING"),
    paymentProofUrl: (p.paymentProofUrl as string | null | undefined) ?? null,
    adminNotes: (p.adminNotes as string | null | undefined) ?? null,
    expirationTime: String(p.expirationTime ?? ""),
    createdAt: String(p.createdAt ?? ""),
    fromCustomLink: Boolean(p.fromCustomLink),
    customLinkSlug: (p.customLinkSlug as string | null | undefined) ?? null,
    fromUserReferral: Boolean(p.fromUserReferral),
    referralReferrer: parseReferralReferrer(p.referralReferrer),
  };
}

function referralReferrerKey(r: ReferralReferrer | null): string {
  return r ? `${r.id}|${r.email}` : "";
}

interface Props {
  purchases: PurchaseItem[];
  initialBlikEnabled: boolean;
  highlightId?: string;
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

export function AdminPaymentsList({ purchases, initialBlikEnabled, highlightId }: Props) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [items, setItems] = useState<PurchaseItem[]>(purchases);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseItem | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [blikEnabled, setBlikEnabled] = useState(initialBlikEnabled);
  const [blikSaving, setBlikSaving] = useState(false);
  const [now, setNow] = useState(Date.now());
  const eventSourceRef = useRef<EventSource | null>(null);
  const highlightHandled = useRef(false);

  useEffect(() => {
    setItems(purchases);
  }, [purchases]);

  useEffect(() => {
    if (!highlightId || highlightHandled.current) return;
    highlightHandled.current = true;

    const match = items.find((p) => p.id === highlightId);
    if (match) {
      setSelectedPurchase(match);
      setNotes(match.adminNotes || "");
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/admin/credits/purchases?status=ALL`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        const found = (data.purchases ?? []).find((p: any) => p.id === highlightId);
        if (found) {
          const item = purchaseItemFromApi(found as Record<string, unknown>);
          setSelectedPurchase(item);
          setNotes(item.adminNotes || "");
        }
      } catch {
        // silently ignore
      }
    })();
  }, [highlightId, items]);

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
          const newItem = purchaseItemFromApi({
            ...(data as Record<string, unknown>),
            status: "PENDING",
            txId: null,
            paymentProofUrl: null,
            adminNotes: null,
            createdAt: (data as { createdAt?: string }).createdAt ?? new Date().toISOString(),
          });
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

        if (data.event === "proof_uploaded") {
          setItems((prev) =>
            prev.map((p) =>
              p.id === data.id ? { ...p, paymentProofUrl: data.paymentProofUrl ?? p.paymentProofUrl } : p
            )
          );
          setSelectedPurchase((prev) =>
            prev && prev.id === data.id
              ? { ...prev, paymentProofUrl: data.paymentProofUrl ?? prev.paymentProofUrl }
              : prev
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

  // Polling fallback: fetch pending purchases every 8s to ensure real-time display
  // even if SSE is blocked/buffered by a proxy
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/admin/credits/purchases?status=PENDING", {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = await res.json();
        const fetched: PurchaseItem[] = (data.purchases ?? []).map((p: Record<string, unknown>) =>
          purchaseItemFromApi(p)
        );
        setItems((prev) => {
          const existingIds = new Set(prev.map((i) => i.id));
          const newOnes = fetched.filter((f) => !existingIds.has(f.id));
          if (newOnes.length === 0) {
            // Update blikCode / expirationTime for existing items
            const fetchedMap = new Map(fetched.map((f) => [f.id, f]));
            let changed = false;
            const updated = prev.map((item) => {
              const fresh = fetchedMap.get(item.id);
              if (
                fresh &&
                (fresh.blikCode !== item.blikCode ||
                  fresh.expirationTime !== item.expirationTime ||
                  fresh.fromCustomLink !== item.fromCustomLink ||
                  fresh.customLinkSlug !== item.customLinkSlug ||
                  fresh.fromUserReferral !== item.fromUserReferral ||
                  referralReferrerKey(fresh.referralReferrer) !== referralReferrerKey(item.referralReferrer))
              ) {
                changed = true;
                return {
                  ...item,
                  blikCode: fresh.blikCode,
                  expirationTime: fresh.expirationTime,
                  fromCustomLink: fresh.fromCustomLink,
                  customLinkSlug: fresh.customLinkSlug,
                  fromUserReferral: fresh.fromUserReferral,
                  referralReferrer: fresh.referralReferrer,
                };
              }
              return item;
            });
            return changed ? updated : prev;
          }
          return [...newOnes, ...prev];
        });
      } catch {
        // Silently ignore polling errors
      }
    };

    const id = setInterval(poll, 8000);
    poll();
    return () => clearInterval(id);
  }, []);

  const handleAction = async (id: string, action: "approve" | "reject") => {
    setActionError(null);
    setLoading(true);
    // Use /complete instead of /approve — some CDNs/WAFs block the literal path "approve" on payment URLs
    const segment = action === "approve" ? "complete" : "reject";
    try {
      const res = await fetch(`/api/admin/credits/purchases/${id}/${segment}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: notes }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((p) => p.id !== id));
        setSelectedPurchase(null);
        setNotes("");
        router.refresh();
        return;
      }
      const text = await res.text();
      let detail = `${res.status}`;
      try {
        const data = JSON.parse(text) as { message?: string; error?: string };
        if (data?.message) detail = data.message;
        else if (data?.error) detail = data.error;
      } catch {
        if (text) detail = text.slice(0, 200);
      }
      setActionError(detail);
      logger.error("Purchase action failed", { status: res.status, segment, id });
    } catch (error) {
      logger.error("Failed to update purchase status", error);
      setActionError(error instanceof Error ? error.message : "Network error");
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
      {actionError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground"
        >
          <p className="font-medium">Could not update purchase</p>
          <p className="mt-1 opacity-90 break-words">{actionError}</p>
        </div>
      )}
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
              className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full px-1 transition-colors cursor-pointer disabled:opacity-50 ${
                blikEnabled ? "bg-green-500" : "bg-red-500/70"
              }`}
            >
              {blikSaving ? (
                <Loader2 className="h-5 w-5 text-white animate-spin mx-auto" />
              ) : (
                <span
                  className={`inline-block h-6 w-6 shrink-0 transform rounded-full bg-white shadow transition-transform ${
                    blikEnabled ? "translate-x-6" : "translate-x-0"
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
                className="overflow-visible"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                transition={{ duration: 0.3 }}
              >
                <Card className="border-warning/20 hover:border-warning/40 transition-colors h-full overflow-visible">
                  <CardContent className="p-5 flex flex-col h-full overflow-visible">
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
                      <div
                        className={`flex items-center justify-between gap-2 text-sm ${
                          p.fromUserReferral && p.referralReferrer ? "group relative" : ""
                        }`}
                      >
                        <span
                          className={`text-muted-foreground shrink-0 inline-flex items-center gap-1.5 ${
                            p.fromUserReferral && p.referralReferrer ? "cursor-help" : ""
                          }`}
                        >
                          <Link2 className="h-3.5 w-3.5 opacity-80" aria-hidden />
                          {t("purchaseSource")}
                        </span>
                        <span className="text-right min-w-0">
                          {p.fromCustomLink ? (
                            <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                              <span className="inline-flex items-center rounded-full bg-emerald-500/12 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300 ring-1 ring-emerald-500/25">
                                {t("purchaseFromRefLink")}
                              </span>
                              {p.customLinkSlug ? (
                                <span className="font-mono text-[11px] text-muted-foreground truncate max-w-[9rem]">
                                  /{p.customLinkSlug}
                                </span>
                              ) : null}
                            </span>
                          ) : p.fromUserReferral ? (
                            <PurchaseReferralSourceHover
                              badgeClassName="bg-violet-500/12 text-violet-800 dark:text-violet-300 ring-violet-500/25"
                              label={t("purchaseFromUserReferral")}
                              referrer={p.referralReferrer}
                              referrerHeading={t("referralReferrerHeading")}
                              openProfileLabel={t("referralOpenInAdmin")}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {t("purchaseNotFromRefLink")}
                            </span>
                          )}
                        </span>
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
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{t("paymentProof")}</span>
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            p.paymentProofUrl ? "text-green-600" : "text-muted-foreground"
                          }`}
                        >
                          {p.paymentProofUrl ? (
                            <>
                              <FileCheck className="h-3 w-3" />
                              {t("proofAttached")}
                            </>
                          ) : (
                            <>
                              <FileX className="h-3 w-3" />
                              {t("noProof")}
                            </>
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-3 border-t border-border">
                      <Button
                        type="button"
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
                        type="button"
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
                <p className="text-muted-foreground flex items-center gap-1.5">
                  <Link2 className="h-3.5 w-3.5" aria-hidden />
                  {t("purchaseSource")}
                </p>
                <p className="font-medium">
                  {selectedPurchase.fromCustomLink ? (
                    <>
                      {t("purchaseFromRefLink")}
                      {selectedPurchase.customLinkSlug ? (
                        <span className="block font-mono text-xs text-muted-foreground mt-0.5">
                          /{selectedPurchase.customLinkSlug}
                        </span>
                      ) : null}
                    </>
                  ) : selectedPurchase.fromUserReferral ? (
                    <span className="space-y-2 block">
                      <span>{t("purchaseFromUserReferral")}</span>
                      {selectedPurchase.referralReferrer ? (
                        <span className="block mt-2 rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-sm">
                          <span className="text-muted-foreground text-xs block mb-1">
                            {t("referralReferrerHeading")}
                          </span>
                          <span className="font-medium">
                            {selectedPurchase.referralReferrer.name?.trim() ||
                              selectedPurchase.referralReferrer.email}
                          </span>
                          {selectedPurchase.referralReferrer.name?.trim() ? (
                            <span className="block text-xs text-muted-foreground mt-0.5">
                              {selectedPurchase.referralReferrer.email}
                            </span>
                          ) : null}
                          <Link
                            href={`/admin/users?userId=${encodeURIComponent(selectedPurchase.referralReferrer.id)}`}
                            className="inline-block mt-2 text-xs font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {t("referralOpenInAdmin")}
                          </Link>
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    t("purchaseNotFromRefLink")
                  )}
                </p>
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

            {selectedPurchase.paymentProofUrl && (
              <div>
                <p className="text-sm text-muted-foreground mb-2">{t("paymentProof")}</p>
                <div className="rounded-lg border border-border bg-muted overflow-hidden">
                  {selectedPurchase.paymentProofUrl.toLowerCase().endsWith(".pdf") ? (
                    <iframe
                      src={`/api/admin/credits/purchases/${selectedPurchase.id}/proof`}
                      title={t("viewProof")}
                      className="w-full h-80"
                    />
                  ) : (
                    <img
                      src={`/api/admin/credits/purchases/${selectedPurchase.id}/proof`}
                      alt={t("viewProof")}
                      className="w-full max-h-80 object-contain"
                    />
                  )}
                  <div className="p-2 border-t border-border">
                    <a
                      href={`/api/admin/credits/purchases/${selectedPurchase.id}/proof`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      {t("viewProof")} →
                    </a>
                  </div>
                </div>
              </div>
            )}

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
              type="button"
              variant="destructive"
              onClick={() => handleAction(selectedPurchase.id, "reject")}
              disabled={loading}
            >
              <XCircle className="h-4 w-4 mr-2" />
              {t("reject")}
            </Button>
            <Button
              type="button"
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
