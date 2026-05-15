"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Coins, CreditCard, Bitcoin, ArrowRight, Upload, Clock, ArrowLeft, CheckCircle, XCircle, FileCheck, Loader2, UserPlus, Check } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PaymentCountdown } from "@/components/payments/payment-countdown";
import { cn, formatCredits, formatPrice } from "@/lib/utils";
import { GROWTH } from "@/lib/growth-event-names";
import { emitGrowthEvent } from "@/lib/growth-events";
import {
  trackBlikPaymentExpired,
  trackCheckoutAbandoned,
  trackCreditsCredited,
  trackPaymentAbandoned,
  trackPaymentProofUploaded,
  trackPaymentRejected,
  trackPromoApplied,
  trackPromoFailed,
  trackPurchaseApiError,
  trackPurchaseCreated,
  trackReferralProgramNudge,
} from "@/lib/growth-analytics";
import { dismissFirstPurchaseNudge, hasDismissedFirstPurchaseNudge } from "@/lib/referral-nudge-storage";

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price: number;
  tier: number;
}

type PaymentMethod = "BLIK" | "CRYPTO" | "PAYPAL" | "REVOLUT";
type CryptoCurrency = "BTC" | "ETH" | "LTC" | "USDC";

type Step = "select-package" | "select-method" | "blik-code" | "payment-details" | "waiting";

interface PaymentResult {
  id: string;
  transactionCode: string;
  blikCode: string | null;
  walletAddress: string | null;
  paypalAddress: string | null;
  revolutAddress: string | null;
  cryptoCurrency: string | null;
  amount: number;
  credits: number;
  expirationTime: string;
  paymentMethod: string;
}

export function CreditPurchaseFlow({
  packages,
  blikEnabled = true,
  priorApprovedCreditPurchases = 0,
  creditBalance,
}: {
  packages: CreditPackage[];
  blikEnabled?: boolean;
  /** Approved credit purchases before this page load (used for first-purchase referral prompt). */
  priorApprovedCreditPurchases?: number;
  creditBalance: number;
}) {
  const t = useTranslations("credits");
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlPromoPrefilled = useRef(false);
  const [step, setStep] = useState<Step>("select-package");
  const pricingViewLogged = useRef(false);
  const checkoutStartedLogged = useRef(false);
  const [selectedPackage, setSelectedPackage] = useState<CreditPackage | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [selectedCrypto, setSelectedCrypto] = useState<CryptoCurrency>("BTC");
  const [blikCode, setBlikCode] = useState("");
  const [txId, setTxId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [proofUploaded, setProofUploaded] = useState(false);
  const [blikExpired, setBlikExpired] = useState(false);
  const [blikSubmitCount, setBlikSubmitCount] = useState(0);
  const [blikCooldown, setBlikCooldown] = useState(0);
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState<{ promoCodeId: string; finalCredits: number; finalPrice: number } | null>(null);
  const [promoError, setPromoError] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const proofInputRef = useRef<HTMLInputElement>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const paymentAbandonLoggedRef = useRef<string | null>(null);
  const creditsLoggedRef = useRef<string | null>(null);
  const rejectedLoggedRef = useRef<string | null>(null);
  const priorApprovedAtMountRef = useRef(priorApprovedCreditPurchases);
  const [approvedPurchaseIdsThisSession, setApprovedPurchaseIdsThisSession] = useState<string[]>([]);
  const firstPurchaseReferralShownRef = useRef(false);
  const [referralPromptHidden, setReferralPromptHidden] = useState(false);
  const checkoutStateRef = useRef({
    step,
    paymentStatus,
    selectedPackage,
    selectedMethod,
    paymentResult,
  });
  checkoutStateRef.current = { step, paymentStatus, selectedPackage, selectedMethod, paymentResult };

  useEffect(() => {
    if (urlPromoPrefilled.current) return;
    const p = searchParams.get("promo");
    if (p?.trim()) {
      setPromoCode(p.trim().toUpperCase());
      urlPromoPrefilled.current = true;
    }
  }, [searchParams]);

  function emitPaymentAbandonedOnce(purchaseId: string, trigger: "unmount" | "pagehide") {
    if (paymentAbandonLoggedRef.current === purchaseId) return;
    paymentAbandonLoggedRef.current = purchaseId;
    const tier = checkoutStateRef.current.selectedPackage?.tier;
    trackPaymentAbandoned(purchaseId, trigger, tier != null ? { tier } : {});
  }

  const skipFirstUnmountRef = useRef(
    typeof process !== "undefined" && process.env.NODE_ENV === "development",
  );
  useEffect(() => {
    return () => {
      if (skipFirstUnmountRef.current) {
        skipFirstUnmountRef.current = false;
        return;
      }
      const s = checkoutStateRef.current;
      if (s.paymentStatus === "APPROVED") return;
      if (s.step === "select-package") return;
      const pendingPurchaseId = s.paymentResult?.id;
      const pendingWait =
        s.step === "waiting" &&
        pendingPurchaseId &&
        (!s.paymentStatus || s.paymentStatus === "PENDING" || s.paymentStatus === "EXPIRED");
      if (pendingWait && pendingPurchaseId) {
        emitPaymentAbandonedOnce(pendingPurchaseId, "unmount");
        return;
      }
      trackCheckoutAbandoned(s.step, {
        tier: s.selectedPackage?.tier,
        method: s.selectedMethod,
      });
    };
  }, []);

  useEffect(() => {
    const onPageHide = () => {
      const s = checkoutStateRef.current;
      if (s.paymentStatus === "APPROVED") return;
      const pendingPurchaseId = s.paymentResult?.id;
      const pendingWait =
        s.step === "waiting" &&
        pendingPurchaseId &&
        (!s.paymentStatus || s.paymentStatus === "PENDING" || s.paymentStatus === "EXPIRED");
      if (pendingWait && pendingPurchaseId) emitPaymentAbandonedOnce(pendingPurchaseId, "pagehide");
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  useEffect(() => {
    if (paymentStatus !== "APPROVED" || !paymentResult?.id) return;
    if (creditsLoggedRef.current === paymentResult.id) return;
    creditsLoggedRef.current = paymentResult.id;
    trackCreditsCredited(paymentResult.id, {
      tier: selectedPackage?.tier,
      method: paymentResult.paymentMethod,
      credits: paymentResult.credits,
    });
  }, [paymentStatus, paymentResult, selectedPackage?.tier]);

  useEffect(() => {
    if (paymentStatus !== "APPROVED" || !paymentResult?.id) return;
    if (priorApprovedAtMountRef.current !== 0) return;
    setApprovedPurchaseIdsThisSession((prev) =>
      prev.includes(paymentResult.id) ? prev : [...prev, paymentResult.id],
    );
  }, [paymentStatus, paymentResult?.id]);

  const isFirstApprovedPurchaseEver =
    priorApprovedAtMountRef.current === 0 && approvedPurchaseIdsThisSession.length === 1;

  const showFirstPurchaseReferral =
    paymentStatus === "APPROVED" &&
    isFirstApprovedPurchaseEver &&
    !referralPromptHidden &&
    !hasDismissedFirstPurchaseNudge();

  useEffect(() => {
    if (!isFirstApprovedPurchaseEver) return;
    if (hasDismissedFirstPurchaseNudge()) return;
    if (firstPurchaseReferralShownRef.current) return;
    firstPurchaseReferralShownRef.current = true;
    trackReferralProgramNudge("first_purchase_success", "shown");
  }, [isFirstApprovedPurchaseEver]);

  useEffect(() => {
    if (paymentStatus !== "REJECTED" || !paymentResult?.id) return;
    if (rejectedLoggedRef.current === paymentResult.id) return;
    rejectedLoggedRef.current = paymentResult.id;
    trackPaymentRejected(paymentResult.id, { tier: selectedPackage?.tier });
  }, [paymentStatus, paymentResult, selectedPackage?.tier]);

  const BLIK_MAX_RETRIES = 5;
  const BLIK_COOLDOWN_SECONDS = 20;

  useEffect(() => {
    setPromoCode("");
    setPromoApplied(null);
    setPromoError("");
  }, [selectedPackage?.id]);

  useEffect(() => {
    if (step !== "select-package" || pricingViewLogged.current) return;
    pricingViewLogged.current = true;
    emitGrowthEvent(GROWTH.PRICING_VIEWED, { surface: "credit_purchase" });
  }, [step]);

  useEffect(() => {
    if (step !== "select-method" || !selectedPackage || checkoutStartedLogged.current) return;
    checkoutStartedLogged.current = true;
    emitGrowthEvent(GROWTH.CHECKOUT_STARTED, { tier: selectedPackage.tier });
  }, [step, selectedPackage]);

  // Sync proofUploaded from server when entering waiting step (e.g. after refresh)
  useEffect(() => {
    if (step !== "waiting" || !paymentResult) return;
    let cancelled = false;
    fetch(`/api/credits/purchase/${paymentResult.id}/status`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.paymentProofUrl) setProofUploaded(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [step, paymentResult?.id]);

  // SSE for real-time payment status, with polling fallback
  useEffect(() => {
    if (step !== "waiting" || !paymentResult) return;
    if (paymentStatus && paymentStatus !== "PENDING") return;

    let eventSource: EventSource | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    function startPolling() {
      if (pollInterval) return;

      const poll = async () => {
        try {
          const res = await fetch(`/api/credits/purchase/${paymentResult!.id}/status`, { credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            if (data.status !== "PENDING") {
              setPaymentStatus(data.status);
              if (pollInterval) clearInterval(pollInterval);
            }
            if (data.paymentProofUrl) {
              setProofUploaded(true);
            }
          }
        } catch {
          // Silent fail, will retry
        }
      };

      poll();
      pollInterval = setInterval(poll, isMobile ? 3000 : 5000);
    }

    if (isMobile) {
      startPolling();
    } else {
      try {
        eventSource = new EventSource(`/api/credits/purchase/${paymentResult.id}/stream`, { withCredentials: true });

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.status && data.status !== "PENDING") {
              setPaymentStatus(data.status);
              eventSource?.close();
            }
          } catch {}
        };

        eventSource.onerror = () => {
          eventSource?.close();
          eventSource = null;
          startPolling();
        };
      } catch {
        startPolling();
      }
    }

    return () => {
      eventSource?.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [step, paymentResult, paymentStatus]);

  const allMethods: { id: PaymentMethod; label: string; icon: React.ReactNode }[] = [
    { id: "BLIK", label: t("paymentMethods.blik"), icon: <CreditCard className="h-5 w-5" /> },
    { id: "CRYPTO", label: t("paymentMethods.crypto"), icon: <Bitcoin className="h-5 w-5" /> },
    { id: "PAYPAL", label: t("paymentMethods.paypal"), icon: <CreditCard className="h-5 w-5" /> },
    { id: "REVOLUT", label: t("paymentMethods.revolut"), icon: <CreditCard className="h-5 w-5" /> },
  ];

  useEffect(() => {
    if (!blikEnabled && selectedMethod === "BLIK") {
      setSelectedMethod(null);
    }
  }, [blikEnabled, selectedMethod]);

  const cryptos: { id: CryptoCurrency; label: string }[] = [
    { id: "BTC", label: t("cryptoCurrencies.btc") },
    { id: "ETH", label: t("cryptoCurrencies.eth") },
    { id: "LTC", label: t("cryptoCurrencies.ltc") },
    { id: "USDC", label: t("cryptoCurrencies.usdc") },
  ];

  const getBlockchainLabel = (currency: string): string => {
    switch (currency) {
      case "BTC": return t("blockchainBtc");
      case "LTC": return t("blockchainLtc");
      case "ETH": return t("blockchainEth");
      case "USDC": return t("blockchainUsdc");
      default: return currency;
    }
  };

  const handleApplyPromo = async () => {
    if (!selectedPackage || !promoCode.trim()) return;
    setPromoLoading(true);
    setPromoError("");
    setPromoApplied(null);
    try {
      const res = await fetch("/api/credits/validate-promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: promoCode.trim(), creditPackageId: selectedPackage.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        trackPromoFailed({ tier: selectedPackage.tier, reason: "api_error", http_status: res.status });
        setPromoError(data.message || "Invalid promo code");
        return;
      }
      if (data.valid && data.promoCodeId) {
        setPromoApplied({ promoCodeId: data.promoCodeId, finalCredits: data.finalCredits, finalPrice: data.finalPrice });
        trackPromoApplied({ tier: selectedPackage.tier });
      } else {
        trackPromoFailed({ tier: selectedPackage.tier, reason: "invalid", http_status: res.status });
        setPromoError(data.message || "Invalid promo code");
      }
    } catch {
      trackPromoFailed({ tier: selectedPackage?.tier, reason: "network", http_status: 0 });
      setPromoError("Failed to validate promo");
    } finally {
      setPromoLoading(false);
    }
  };

  const handleMethodNext = () => {
    if (!selectedMethod) return;
    if (selectedMethod === "BLIK" && !blikEnabled) return;
    if (selectedMethod === "BLIK") {
      setStep("blik-code");
    } else {
      handleCreatePurchase();
    }
  };

  const handleCreatePurchase = async (blikCodeOverride?: string) => {
    if (!selectedPackage || !selectedMethod) return;

    setLoading(true);
    setError("");

    try {
      emitGrowthEvent(GROWTH.PAYMENT_METHOD_SELECTED, {
        method: selectedMethod,
        crypto: selectedMethod === "CRYPTO" ? selectedCrypto : undefined,
      });
      const res = await fetch("/api/credits/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          creditPackageId: selectedPackage.id,
          paymentMethod: selectedMethod,
          cryptoCurrency: selectedMethod === "CRYPTO" ? selectedCrypto : undefined,
          blikCode: selectedMethod === "BLIK" ? (blikCodeOverride || blikCode) : undefined,
          promoCodeId: promoApplied?.promoCodeId || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        trackPurchaseApiError(res.status, { tier: selectedPackage?.tier });
        const errorMessage = data.message || data.error || t("paymentFailed");
        setError(errorMessage);
        return;
      }

      const purchaseId = data?.id as string | undefined;
      if (purchaseId) {
        trackPurchaseCreated(purchaseId, {
          tier: selectedPackage.tier,
          method: selectedMethod,
          crypto: selectedMethod === "CRYPTO" ? selectedCrypto : undefined,
        });
      }
      setPaymentResult(data);
      setStep("waiting");
    } catch {
      trackPurchaseApiError(0, { error_class: "network", tier: selectedPackage?.tier });
      setError(t("createPurchaseFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitTxId = async () => {
    if (!paymentResult || !txId.trim()) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/credits/purchase/${paymentResult.id}/txid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ txId: txId.trim() }),
      });

      if (res.ok) {
        setTxId("");
      }
    } catch {
      // Silent fail, user can retry
    } finally {
      setLoading(false);
    }
  };

  const handleProofUpload = async (file: File) => {
    if (!paymentResult) return;
    setProofUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/credits/purchase/${paymentResult.id}/proof`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.message || data.error || "Failed to upload proof");
        return;
      }

      trackPaymentProofUploaded(paymentResult.id);
      setProofUploaded(true);
    } catch {
      setError(t("uploadProofFailed"));
    } finally {
      setProofUploading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  const startBlikCooldown = () => {
    setBlikCooldown(BLIK_COOLDOWN_SECONDS);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setBlikCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleBlikExpiredNewCode = async () => {
    if (!paymentResult || !blikCode.trim() || blikCode.trim().length < 6) {
      setError(t("enterValidBlikCode"));
      return;
    }

    if (blikSubmitCount >= BLIK_MAX_RETRIES) {
      setError(t("blikMaxRetriesReached"));
      return;
    }

    if (blikCooldown > 0) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/credits/purchase/${paymentResult.id}/blik`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ blikCode: blikCode.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMessage = data.message || data.error || t("updateBlikFailed");
        setError(errorMessage);
        return;
      }

      setPaymentResult((prev) =>
        prev ? { ...prev, blikCode: blikCode.trim(), expirationTime: data.expirationTime } : prev
      );
      setBlikCode("");
      setBlikExpired(false);
      setPaymentStatus(null);
      setBlikSubmitCount((prev) => prev + 1);
      startBlikCooldown();
    } catch {
      setError(t("updateBlikFailed"));
    } finally {
      setLoading(false);
    }
  };

  const showBlikMilestone =
    selectedMethod === "BLIK" ||
    step === "blik-code" ||
    paymentResult?.paymentMethod === "BLIK";

  const showPendingPaymentUi =
    step === "waiting" &&
    paymentResult &&
    (!paymentStatus || paymentStatus === "PENDING" || paymentStatus === "EXPIRED");

  const visibleMilestones = [
    { key: "pkg", label: t("selectPackage") },
    { key: "meth", label: t("selectMethod") },
    ...(showBlikMilestone ? [{ key: "blik" as const, label: t("enterBlikCode") }] : []),
    { key: "pend", label: t("pending") },
  ];

  let currentMsIdx = 0;
  if (step === "select-package") currentMsIdx = 0;
  else if (step === "select-method") currentMsIdx = 1;
  else if (step === "blik-code") currentMsIdx = showBlikMilestone ? 2 : 1;
  else if (step === "waiting") currentMsIdx = visibleMilestones.length - 1;

  const allMilestonesComplete =
    step === "waiting" && (paymentStatus === "APPROVED" || paymentStatus === "REJECTED");

  const selectedMethodLabel = selectedMethod
    ? allMethods.find((m) => m.id === selectedMethod)?.label ?? selectedMethod
    : null;

  const stickyMobileActions = cn(
    "sticky bottom-0 z-30 -mx-2 mt-4 flex gap-2 px-2 py-3 sm:-mx-4 sm:gap-3 sm:px-4",
    "border-t border-border/50 bg-background/90 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md",
    "supports-[backdrop-filter]:bg-background/80",
    "lg:static lg:z-auto lg:mx-0 lg:border-t-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none",
  );

  const orderSummaryDesktop = selectedPackage && (
    <div className="rounded-xl border border-border/70 bg-background/60 p-4 text-sm dark:bg-background/40 hidden lg:block">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("selectPackage")}</p>
      <p className="mt-1 font-semibold text-foreground">{selectedPackage.name}</p>
      <div className="mt-2 flex justify-between gap-2 text-muted-foreground">
        <span>
          {promoApplied ? promoApplied.finalCredits : selectedPackage.credits} {t("creditsLabel")}
        </span>
        <span className="font-medium tabular-nums text-foreground">
          {formatPrice(promoApplied ? promoApplied.finalPrice : selectedPackage.price)}
        </span>
      </div>
      {selectedMethodLabel && step !== "select-package" && (
        <p className="mt-3 border-t border-border/50 pt-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{t("selectMethod")}:</span> {selectedMethodLabel}
          {selectedMethod === "CRYPTO" && (
            <span className="ml-1 font-mono text-[11px]">({selectedCrypto})</span>
          )}
        </p>
      )}
    </div>
  );

  const orderSummaryMobileDetails =
    selectedPackage &&
    step !== "select-package" && (
      <details className="rounded-xl border border-border/70 bg-background/60 lg:hidden dark:bg-background/40">
        <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate">{selectedPackage.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatPrice(promoApplied ? promoApplied.finalPrice : selectedPackage.price)}
            </span>
          </span>
        </summary>
        <div className="space-y-2 border-t border-border/50 px-3 pb-3 pt-2 text-xs text-muted-foreground">
          <div className="flex justify-between gap-2">
            <span>{t("creditsLabel")}</span>
            <span className="font-medium text-foreground">
              {promoApplied ? promoApplied.finalCredits : selectedPackage.credits}
            </span>
          </div>
          {selectedMethodLabel && (
            <p>
              <span className="font-medium text-foreground">{t("selectMethod")}:</span> {selectedMethodLabel}
              {selectedMethod === "CRYPTO" && (
                <span className="ml-1 font-mono">({selectedCrypto})</span>
              )}
            </p>
          )}
        </div>
      </details>
    );

  return (
    <div className="mx-auto w-full max-w-6xl px-1 sm:px-0">
      <div className="grid gap-4 lg:grid-cols-[minmax(272px,320px)_minmax(0,1fr)] lg:gap-10 xl:gap-12 items-start">
        <aside
          className={cn(
            "space-y-3 rounded-2xl border border-border/80 bg-muted/20 p-3 sm:p-4 lg:space-y-5 lg:p-5 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:self-start",
            "dark:border-white/[0.08] dark:bg-muted/10",
            showPendingPaymentUi ? "order-1 lg:order-1" : "order-2 lg:order-1",
          )}
          aria-label={t("title")}
        >
          <header className="border-b border-border/60 pb-3 lg:space-y-1 lg:pb-4">
            <h1 className="sr-only">{t("title")}</h1>
            <div className="flex items-start justify-between gap-2 lg:hidden">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("title")}</p>
                <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-sm text-foreground">
                  <Coins className="inline h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                  <span className="font-semibold tabular-nums">
                    {formatCredits(creditBalance)} {t("creditsLabel")}
                  </span>
                </p>
              </div>
              <span
                className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-primary"
                aria-hidden
              >
                {currentMsIdx + 1}/{visibleMilestones.length}
              </span>
            </div>
            <p className="hidden lg:flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
              <span className="text-base font-semibold tracking-tight text-foreground">{t("title")}</span>
              <span className="text-muted-foreground/40" aria-hidden>
                ·
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Coins className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                {t("balance")}:
              </span>
              <span className="font-semibold tabular-nums text-foreground">
                {formatCredits(creditBalance)} {t("creditsLabel")}
              </span>
            </p>
            <p className="mt-1.5 truncate text-xs text-muted-foreground lg:hidden" title={visibleMilestones[currentMsIdx]?.label}>
              {visibleMilestones[currentMsIdx]?.label}
            </p>
          </header>

          <nav aria-label="Checkout progress" className="hidden lg:block">
            <ol className="space-y-0">
              {visibleMilestones.map((ms, i) => {
                const done = allMilestonesComplete || i < currentMsIdx;
                const current = !allMilestonesComplete && i === currentMsIdx;
                return (
                  <li key={ms.key} className="flex gap-3">
                    <span className="flex flex-col items-center pt-0.5">
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium",
                          done && "border-primary/40 bg-primary/15 text-primary",
                          current && !done && "border-primary bg-primary text-primary-foreground",
                          !done && !current && "border-border bg-muted/50 text-muted-foreground",
                        )}
                      >
                        {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                      </span>
                      {i < visibleMilestones.length - 1 && (
                        <span
                          className={cn(
                            "my-1 min-h-[12px] w-px flex-1",
                            i < currentMsIdx || allMilestonesComplete ? "bg-primary/30" : "bg-border",
                          )}
                          aria-hidden
                        />
                      )}
                    </span>
                    <span
                      className={cn(
                        "pb-4 text-sm leading-snug last:pb-0",
                        current && "font-medium text-foreground",
                        done && !current && "text-muted-foreground",
                        !done && !current && "text-muted-foreground/80",
                      )}
                    >
                      {ms.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>

          {orderSummaryDesktop}
          {orderSummaryMobileDetails}

          {showPendingPaymentUi && paymentResult && (
            <div className="space-y-2 border-t border-border/60 pt-3 lg:space-y-3 lg:pt-4">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground lg:text-xs">{t("pending")}</p>
              <div className="max-lg:scale-[0.94] max-lg:origin-top">
                <PaymentCountdown
                  expirationTime={paymentResult.expirationTime}
                  isBlik={paymentResult.paymentMethod === "BLIK"}
                  onBlikExpired={(expired) => {
                    setBlikExpired(expired);
                    if (expired) trackBlikPaymentExpired();
                  }}
                />
              </div>
            </div>
          )}

          {step === "waiting" && paymentResult && paymentStatus === "APPROVED" && (
            <div className="hidden items-start gap-3 rounded-xl border border-green-500/35 bg-green-500/[0.07] p-4 lg:flex">
              <CheckCircle className="mt-0.5 h-8 w-8 shrink-0 text-green-500" aria-hidden />
              <div>
                <p className="font-semibold text-green-600 dark:text-green-400">{t("paymentApprovedTitle")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("creditsAdded", { credits: paymentResult.credits })}</p>
              </div>
            </div>
          )}

          {step === "waiting" && paymentResult && paymentStatus === "REJECTED" && (
            <div className="hidden items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/[0.06] p-4 lg:flex">
              <XCircle className="mt-0.5 h-8 w-8 shrink-0 text-destructive" aria-hidden />
              <div>
                <p className="font-semibold text-destructive">{t("paymentRejectedTitle")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("paymentRejectedMessage")}</p>
              </div>
            </div>
          )}
        </aside>

        <div
          className={cn(
            "min-w-0",
            showPendingPaymentUi ? "order-2 lg:order-2" : "order-1 lg:order-2",
          )}
        >
      <AnimatePresence mode="wait">
        {/* Step 1: Select Package */}
        {step === "select-package" && (
          <motion.div
            key="packages"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="pb-1 lg:pb-0"
          >
            <h2 className="mb-3 text-base font-semibold lg:mb-4 lg:text-lg">{t("selectPackage")}</h2>
            <div className="grid gap-2 sm:gap-3">
              {packages.map((pkg, index) => (
                <Card
                  key={pkg.id}
                  className={`cursor-pointer transition-all press-effect hover:border-primary/30 animate-in fade-in stagger-${Math.min(index + 1, 5)} ${selectedPackage?.id === pkg.id ? "border-primary/50 ring-2 ring-primary/15 bg-primary/[0.03]" : "border-white/[0.06]"
                    }`}
                  onClick={() => setSelectedPackage(pkg)}
                >
                  <CardContent className="flex items-center justify-between gap-2 p-3 sm:gap-3 sm:p-4 max-[420px]:flex-col max-[420px]:items-start">
                    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                      <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-primary/10 shrink-0">
                        <Coins className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-base sm:text-lg">{pkg.name}</p>
                        <p className="text-xs sm:text-sm text-muted-foreground">
                          {pkg.credits} credits &middot; {formatPrice(pkg.price / pkg.credits, undefined, { exact: true })} {t("perCredit")}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right max-[420px]:w-full max-[420px]:text-left">
                      <p className="text-xl sm:text-2xl font-bold">{formatPrice(pkg.price)}</p>
                      <p className="text-xs sm:text-sm text-primary">{pkg.credits} credits</p>
                      {pkg.tier >= 3 && (
                        <Badge variant="default" className="mt-1 text-[10px]">
                          {pkg.tier === 4 ? t("bestValue") : t("popular")}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            {selectedPackage && (
              <div className="mt-3 space-y-2 lg:mt-4">
                <p className="text-sm font-medium text-muted-foreground">{t("promoCode")}</p>
                <div className="flex gap-2">
                  <Input
                    placeholder={t("promoCodePlaceholder")}
                    value={promoCode}
                    onChange={(e) => {
                      setPromoCode(e.target.value.toUpperCase());
                      setPromoApplied(null);
                      setPromoError("");
                    }}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    onClick={handleApplyPromo}
                    disabled={!promoCode.trim() || promoLoading}
                  >
                    {promoLoading ? "..." : t("applyPromo")}
                  </Button>
                </div>
                {promoError && <p className="text-sm text-destructive">{promoError}</p>}
                {promoApplied && (
                  <p className="text-sm text-green-500">
                    {t("promoApplied", { credits: promoApplied.finalCredits, price: formatPrice(promoApplied.finalPrice) })}
                  </p>
                )}
              </div>
            )}
            <div className={stickyMobileActions}>
              <Button
                className="h-11 w-full"
                disabled={!selectedPackage}
                onClick={() => setStep("select-method")}
              >
                {t("selectMethod")} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        )}

        {/* Step 2: Select Method */}
        {step === "select-method" && (
          <motion.div
            key="method"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="pb-1 lg:pb-0"
          >
            <h2 className="mb-3 text-base font-semibold lg:mb-4 lg:text-lg">{t("selectMethod")}</h2>
            <div className="grid grid-cols-2 gap-2 sm:gap-3 max-[360px]:grid-cols-1">
              {allMethods.map((method) => {
                const blikClosed = method.id === "BLIK" && !blikEnabled;
                return (
                  <Card
                    key={method.id}
                    title={blikClosed ? t("blikUnavailableHint") : undefined}
                    aria-disabled={blikClosed}
                    tabIndex={blikClosed ? -1 : undefined}
                    className={cn(
                      "transition-all border-white/[0.06]",
                      blikClosed
                        ? "cursor-not-allowed opacity-55 hover:border-white/[0.06]"
                        : "cursor-pointer press-effect hover:border-primary/30",
                      !blikClosed && selectedMethod === method.id
                        ? "border-primary/50 ring-2 ring-primary/15 bg-primary/[0.03]"
                        : "",
                    )}
                    onClick={() => {
                      if (blikClosed) return;
                      setSelectedMethod(method.id);
                    }}
                  >
                    <CardContent className="flex flex-col items-center justify-center gap-2 p-4 sm:p-6">
                      {method.icon}
                      <p className="font-medium text-xs sm:text-sm">{method.label}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            {!blikEnabled && (
              <p className="mt-3 text-xs text-muted-foreground sm:mt-4">{t("blikUnavailableHint")}</p>
            )}

            {/* Crypto selector - grid-template-rows avoids layout thrashing */}
            {selectedMethod === "CRYPTO" && (
              <motion.div
                initial={{ gridTemplateRows: "0fr", opacity: 0 }}
                animate={{ gridTemplateRows: "1fr", opacity: 1 }}
                className="grid mt-4"
              >
                <div className="min-h-0 overflow-hidden">
                <p className="text-sm font-medium mb-2">{t("selectCryptocurrency")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {cryptos.map((crypto) => (
                    <button
                      key={crypto.id}
                      onClick={() => setSelectedCrypto(crypto.id)}
                      className={`px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${selectedCrypto === crypto.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary hover:bg-secondary/80"
                        }`}
                    >
                      {crypto.label}
                    </button>
                  ))}
                </div>
                </div>
              </motion.div>
            )}

            {error && <p className="mt-3 text-sm text-destructive lg:mt-4">{error}</p>}

            <div className={stickyMobileActions}>
              <Button variant="outline" onClick={() => setStep("select-package")} className="min-h-11 flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" /> {t("back")}
              </Button>
              <Button
                className="min-h-11 flex-1"
                disabled={
                  !selectedMethod ||
                  loading ||
                  (selectedMethod === "BLIK" && !blikEnabled)
                }
                onClick={handleMethodNext}
              >
                {loading ? "..." : t("continue")} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        )}

        {/* Step 2b: BLIK Code Entry */}
        {step === "blik-code" && (
          <motion.div
            key="blik-code"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="pb-1 lg:pb-0"
          >
            <h2 className="mb-3 text-lg font-semibold lg:mb-4 lg:text-xl">{t("enterBlikCode")}</h2>
            <Card>
              <CardContent className="space-y-3 p-4 sm:space-y-4 sm:p-6">
                <p className="text-sm text-muted-foreground">{t("blikInstructions")}</p>
                <Input
                  placeholder="123456"
                  value={blikCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setBlikCode(val);
                  }}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  className="h-14 text-center text-2xl font-mono tracking-[0.45em] sm:h-16 sm:text-3xl sm:tracking-[0.5em]"
                  maxLength={6}
                />
                <p className="text-xs text-muted-foreground text-center">
                  {blikCode.length}/6 digits
                </p>
              </CardContent>
            </Card>

            {error && <p className="mt-3 text-sm text-destructive lg:mt-4">{error}</p>}

            <div className={stickyMobileActions}>
              <Button variant="outline" onClick={() => setStep("select-method")} className="min-h-11 flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" /> {t("back")}
              </Button>
              <Button
                className="min-h-11 flex-1"
                disabled={blikCode.length < 6 || loading}
                onClick={() => handleCreatePurchase()}
              >
                {loading ? "..." : t("submitBlik")} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        )}

        {/* Step 3: Waiting / Payment Details */}
        {step === "waiting" && paymentResult && (
          <motion.div
            key="waiting"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {/* Payment Approved */}
            {paymentStatus === "APPROVED" && (
              <Card className="border-green-500/50">
                <CardContent className="space-y-4 p-5 text-center sm:p-8">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                  >
                    <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
                  </motion.div>
                  <h3 className="text-xl font-bold text-green-500">{t("paymentApprovedTitle")}</h3>
                  <p className="text-muted-foreground">
                    {t("creditsAdded", { credits: paymentResult.credits })}
                  </p>
                  {showFirstPurchaseReferral && (
                    <div className="rounded-lg border border-border bg-muted/30 p-4 text-left">
                      <div className="flex gap-3">
                        <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-sm font-medium">{t("referralPromptTitle")}</p>
                          <p className="text-xs text-muted-foreground leading-relaxed">{t("referralPromptDesc")}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                          href="/referral"
                          className={cn(buttonVariants({ size: "sm" }), "h-9 inline-flex")}
                          onClick={() => trackReferralProgramNudge("first_purchase_success", "cta_click")}
                        >
                          {t("referralPromptCta")}
                        </Link>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 text-muted-foreground"
                          onClick={() => {
                            dismissFirstPurchaseNudge();
                            setReferralPromptHidden(true);
                            trackReferralProgramNudge("first_purchase_success", "dismissed");
                          }}
                        >
                          {t("referralPromptDismiss")}
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col gap-2 pt-4 sm:flex-row sm:gap-3">
                    <Button
                      className="w-full sm:flex-1"
                      onClick={() => router.push("/")}
                    >
                      {t("browseModels")}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full sm:flex-1"
                      onClick={() => {
                        setStep("select-package");
                        setPaymentResult(null);
                        setPaymentStatus(null);
                        setSelectedPackage(null);
                        setSelectedMethod(null);
                        setBlikCode("");
                        setTxId("");
                        setError("");
                      }}
                    >
                      {t("buyMoreCredits")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Payment Rejected */}
            {paymentStatus === "REJECTED" && (
              <Card className="border-destructive/50">
                <CardContent className="space-y-4 p-5 text-center sm:p-8">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                  >
                    <XCircle className="h-16 w-16 text-destructive mx-auto" />
                  </motion.div>
                  <h3 className="text-xl font-bold text-destructive">{t("paymentRejectedTitle")}</h3>
                  <p className="text-muted-foreground">
                    {t("paymentRejectedMessage")}
                  </p>
                  <Button
                    className="w-full mt-4"
                    onClick={() => {
                      setStep("select-package");
                      setPaymentResult(null);
                      setPaymentStatus(null);
                      setSelectedPackage(null);
                      setSelectedMethod(null);
                      setBlikCode("");
                      setTxId("");
                      setError("");
                    }}
                  >
                    {t("tryAgain")}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Pending / Waiting */}
            {(!paymentStatus || paymentStatus === "PENDING" || paymentStatus === "EXPIRED") && (
              <Card>
                <CardHeader className="space-y-2 px-4 pb-2 pt-4 text-center sm:space-y-2.5 sm:px-6 sm:pb-4 sm:pt-6">
                  <CardTitle className="flex items-center justify-center gap-2 text-base sm:text-lg">
                    <Clock className="h-4 w-4 shrink-0 text-primary sm:h-5 sm:w-5" />
                    {t("pending")}
                  </CardTitle>
                  <CardDescription className="mx-auto max-w-md text-pretty leading-relaxed">
                    {t("pendingManualVerification")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 px-4 pb-4 sm:space-y-6 sm:px-6 sm:pb-6">
                  {/* Transaction code */}
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">{t("transactionCode")}</p>
                    <p className="mt-1 break-all text-xl font-bold font-mono sm:text-2xl">{paymentResult.transactionCode}</p>
                  </div>

                  {/* BLIK code display */}
                  {paymentResult.blikCode && paymentResult.paymentMethod === "BLIK" && (
                    <div className="text-center p-4 rounded-xl bg-primary/10 border border-primary/20">
                      <p className="text-sm text-muted-foreground">{t("yourBlikCode")}</p>
                      <p className="text-4xl font-mono font-bold mt-2 text-primary tracking-wider">
                        {paymentResult.blikCode}
                      </p>
                    </div>
                  )}

                  {/* BLIK expired: enter new code - grid-template-rows avoids layout thrashing */}
                  {paymentResult.paymentMethod === "BLIK" && blikExpired && (
                    <motion.div
                      initial={{ gridTemplateRows: "0fr", opacity: 0 }}
                      animate={{ gridTemplateRows: "1fr", opacity: 1 }}
                      className="grid border-t border-border pt-4"
                    >
                    <div className="min-h-0 overflow-hidden space-y-3">
                      {blikSubmitCount >= BLIK_MAX_RETRIES ? (
                        <p className="text-sm text-destructive font-medium">{t("blikMaxRetriesReached")}</p>
                      ) : (
                        <>
                          <p className="text-sm font-medium">{t("blikExpiredNewCode")}</p>
                          <div className="flex gap-2">
                            <Input
                              placeholder="123456"
                              value={blikCode}
                              onChange={(e) => {
                                const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                                setBlikCode(val);
                              }}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              className="flex-1 text-center font-mono text-lg"
                              maxLength={6}
                            />
                            <Button
                              onClick={handleBlikExpiredNewCode}
                              disabled={blikCode.length < 6 || loading || blikCooldown > 0}
                              size="sm"
                            >
                              {blikCooldown > 0 ? `${blikCooldown}s` : t("submitNewBlik")}
                            </Button>
                          </div>
                          {blikSubmitCount > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {t("blikRetriesRemaining", { count: BLIK_MAX_RETRIES - blikSubmitCount })}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                    </motion.div>
                  )}

                  {/* Crypto wallet */}
                  {paymentResult.walletAddress && (
                    <div className="space-y-3">
                      <div className="p-4 rounded-xl bg-secondary border border-border">
                        <p className="text-sm text-muted-foreground">{t("walletAddress")}</p>
                        <p className="text-sm font-mono mt-1 break-all">{paymentResult.walletAddress}</p>
                      </div>
                      <p className="text-sm font-medium text-center">
                        {t("useBlockchain", { blockchain: getBlockchainLabel(paymentResult.cryptoCurrency || "") })}
                      </p>
                      <p className="text-sm text-center text-muted-foreground">
                        {t("sendExactAmount", { amount: `${formatPrice(paymentResult.amount)} (${paymentResult.cryptoCurrency})` })}
                      </p>

                      {/* TxID input */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium">{t("enterTxId")}</p>
                        <div className="flex gap-2">
                          <Input
                            placeholder={t("txIdPlaceholder")}
                            value={txId}
                            onChange={(e) => setTxId(e.target.value)}
                            className="flex-1"
                          />
                          <Button
                            onClick={handleSubmitTxId}
                            disabled={!txId.trim() || loading}
                            size="sm"
                          >
                            {t("submitTxId")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* PayPal instructions */}
                  {paymentResult.paymentMethod === "PAYPAL" && (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">{t("paypalInstructions")}</p>
                      <div className="p-4 rounded-xl bg-secondary border border-border">
                        <p className="text-sm text-muted-foreground">{t("paypalAddress")}</p>
                        <p className="text-sm font-mono font-semibold mt-1 break-all">
                          {paymentResult.paypalAddress || "—"}
                        </p>
                      </div>
                      <p className="text-xs text-center text-muted-foreground">
                        {t("sendExactAmount", { amount: formatPrice(paymentResult.amount) })}
                      </p>
                    </div>
                  )}

                  {/* Revolut instructions */}
                  {paymentResult.paymentMethod === "REVOLUT" && (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">{t("revolutInstructions")}</p>
                      <div className="p-4 rounded-xl bg-secondary border border-border">
                        <p className="text-sm text-muted-foreground">{t("revolutAddress")}</p>
                        <p className="text-sm font-mono font-semibold mt-1 break-all">
                          {paymentResult.revolutAddress || "—"}
                        </p>
                      </div>
                      <p className="text-xs text-center text-muted-foreground">
                        {t("sendExactAmount", { amount: formatPrice(paymentResult.amount) })}
                      </p>
                    </div>
                  )}

                  {/* Amount */}
                  <div className="flex justify-between text-sm border-t border-border pt-4">
                    <span className="text-muted-foreground">{t("amount")}</span>
                    <span className="font-semibold">{formatPrice(paymentResult.amount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("creditsLabel")}</span>
                    <span className="font-semibold">{paymentResult.credits}</span>
                  </div>

                  {error && <p className="text-sm text-destructive">{error}</p>}

                  {/* Upload proof */}
                  <div className="text-center space-y-2">
                    <input
                      ref={proofInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleProofUpload(file);
                      }}
                    />
                    {proofUploaded ? (
                      <div className="inline-flex items-center gap-2 text-green-600 text-sm font-medium">
                        <FileCheck className="h-4 w-4" />
                        {t("proofUploadedSuccess")}
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        className="gap-2 min-h-[44px]"
                        disabled={proofUploading}
                        onClick={() => proofInputRef.current?.click()}
                      >
                        {proofUploading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                        {proofUploading ? t("uploading") : t("uploadProof")}
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">
                      JPEG, PNG, WebP, GIF, PDF &middot; Max 10 MB
                    </p>
                    <p className="text-xs text-muted-foreground italic">
                      {t("proofSpeedsUpPurchase")}
                    </p>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setStep("select-package");
                      setPaymentResult(null);
                      setPaymentStatus(null);
                      setSelectedPackage(null);
                      setSelectedMethod(null);
                      setBlikCode("");
                      setTxId("");
                      setError("");
                    }}
                  >
                    {t("newPurchase")}
                  </Button>
                </CardContent>
              </Card>
            )}
          </motion.div>
        )}
      </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
