"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Coins, CreditCard, Bitcoin, ArrowRight, Upload, Clock, ArrowLeft, CheckCircle, XCircle, FileCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PaymentCountdown } from "@/components/payments/payment-countdown";
import { formatPrice } from "@/lib/utils";

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price: number;
  tier: number;
}

type PaymentMethod = "BLIK" | "CRYPTO" | "PAYPAL" | "REVOLUT";
type CryptoCurrency = "BTC" | "ETH" | "USDT" | "USDC";

type Step = "select-package" | "select-method" | "blik-code" | "payment-details" | "waiting";

interface PaymentResult {
  id: string;
  transactionCode: string;
  blikCode: string | null;
  walletAddress: string | null;
  cryptoCurrency: string | null;
  amount: number;
  credits: number;
  expirationTime: string;
  paymentMethod: string;
}

export function CreditPurchaseFlow({ packages, blikEnabled = true }: { packages: CreditPackage[]; blikEnabled?: boolean }) {
  const t = useTranslations("credits");
  const router = useRouter();
  const [step, setStep] = useState<Step>("select-package");
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
  const proofInputRef = useRef<HTMLInputElement>(null);

  // SSE for real-time payment status, with polling fallback
  useEffect(() => {
    if (step !== "waiting" || !paymentResult) return;
    if (paymentStatus && paymentStatus !== "PENDING") return;

    let eventSource: EventSource | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    // Try SSE first
    try {
      eventSource = new EventSource(`/api/credits/purchase/${paymentResult.id}/stream`, { withCredentials: true });

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.status && data.status !== "PENDING") {
            setPaymentStatus(data.status);
            eventSource?.close();
          }
        } catch {
          // Ignore parse errors
        }
      };

      eventSource.onerror = () => {
        // SSE failed, fall back to polling
        eventSource?.close();
        eventSource = null;
        startPolling();
      };
    } catch {
      // SSE not supported, fall back to polling
      startPolling();
    }

    function startPolling() {
      if (pollInterval) return; // Already polling

      const poll = async () => {
        try {
          const res = await fetch(`/api/credits/purchase/${paymentResult!.id}/status`, { credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            if (data.status !== "PENDING") {
              setPaymentStatus(data.status);
              if (pollInterval) clearInterval(pollInterval);
            }
          }
        } catch {
          // Silent fail, will retry
        }
      };

      poll();
      pollInterval = setInterval(poll, 5000);
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

  const methods = blikEnabled ? allMethods : allMethods.filter((m) => m.id !== "BLIK");

  const cryptos: { id: CryptoCurrency; label: string }[] = [
    { id: "BTC", label: t("cryptoCurrencies.btc") },
    { id: "ETH", label: t("cryptoCurrencies.eth") },
    { id: "USDT", label: t("cryptoCurrencies.usdt") },
    { id: "USDC", label: t("cryptoCurrencies.usdc") },
  ];

  const handleMethodNext = () => {
    if (!selectedMethod) return;
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
      const res = await fetch("/api/credits/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          creditPackageId: selectedPackage.id,
          paymentMethod: selectedMethod,
          cryptoCurrency: selectedMethod === "CRYPTO" ? selectedCrypto : undefined,
          blikCode: selectedMethod === "BLIK" ? (blikCodeOverride || blikCode) : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMessage = data.message || data.error || "Payment failed";
        setError(errorMessage);
        return;
      }

      setPaymentResult(data);
      setStep("waiting");
    } catch {
      setError("Failed to create purchase. Please try again.");
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

      setProofUploaded(true);
    } catch {
      setError("Failed to upload payment proof. Please try again.");
    } finally {
      setProofUploading(false);
    }
  };

  const handleBlikExpiredNewCode = async () => {
    if (!paymentResult || !blikCode.trim() || blikCode.trim().length < 6) {
      setError("Enter a valid 6-digit BLIK code");
      return;
    }

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
        const errorMessage = data.message || data.error || "Failed to update BLIK code";
        setError(errorMessage);
        return;
      }

      // Update the expiration time in the result
      setPaymentResult((prev) =>
        prev ? { ...prev, blikCode: blikCode.trim(), expirationTime: data.expirationTime } : prev
      );
      setBlikCode("");
    } catch {
      setError("Failed to update BLIK code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <AnimatePresence mode="wait">
        {/* Step 1: Select Package */}
        {step === "select-package" && (
          <motion.div
            key="packages"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            <h2 className="text-lg font-semibold mb-4">{t("selectPackage")}</h2>
            <div className="grid gap-3">
              {packages.map((pkg, index) => (
                <Card
                  key={pkg.id}
                  className={`cursor-pointer transition-all press-effect hover:border-primary/30 animate-in fade-in stagger-${Math.min(index + 1, 5)} ${
                    selectedPackage?.id === pkg.id ? "border-primary/50 ring-2 ring-primary/15 bg-primary/[0.03]" : "border-white/[0.06]"
                  }`}
                  onClick={() => setSelectedPackage(pkg)}
                >
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-primary/10 shrink-0">
                        <Coins className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-base sm:text-lg">{pkg.name}</p>
                        <p className="text-xs sm:text-sm text-muted-foreground">
                          {pkg.credits} credits &middot; {formatPrice(pkg.price / pkg.credits)} {t("perCredit")}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
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
            <Button
              className="w-full mt-6 h-11"
              disabled={!selectedPackage}
              onClick={() => setStep("select-method")}
            >
              {t("selectMethod")} <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
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
          >
            <h2 className="text-lg font-semibold mb-4">{t("selectMethod")}</h2>
            <div className="grid grid-cols-2 gap-3">
              {methods.map((method) => (
                <Card
                  key={method.id}
                  className={`cursor-pointer transition-all press-effect hover:border-primary/30 ${
                    selectedMethod === method.id ? "border-primary/50 ring-2 ring-primary/15 bg-primary/[0.03]" : "border-white/[0.06]"
                  }`}
                  onClick={() => setSelectedMethod(method.id)}
                >
                  <CardContent className="flex flex-col items-center justify-center p-5 sm:p-6 gap-2">
                    {method.icon}
                    <p className="font-medium text-xs sm:text-sm">{method.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Crypto selector */}
            {selectedMethod === "CRYPTO" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="mt-4"
              >
                <p className="text-sm font-medium mb-2">Select cryptocurrency:</p>
                <div className="grid grid-cols-2 gap-2">
                  {cryptos.map((crypto) => (
                    <button
                      key={crypto.id}
                      onClick={() => setSelectedCrypto(crypto.id)}
                      className={`px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                        selectedCrypto === crypto.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary hover:bg-secondary/80"
                      }`}
                    >
                      {crypto.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {error && <p className="text-sm text-destructive mt-4">{error}</p>}

            <div className="flex gap-3 mt-6">
              <Button variant="outline" onClick={() => setStep("select-package")} className="flex-1">
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button
                className="flex-1"
                disabled={!selectedMethod || loading}
                onClick={handleMethodNext}
              >
                {loading ? "..." : "Continue"} <ArrowRight className="h-4 w-4 ml-2" />
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
          >
            <h2 className="text-xl font-semibold mb-4">{t("enterBlikCode")}</h2>
            <Card>
              <CardContent className="p-6 space-y-4">
                <p className="text-sm text-muted-foreground">{t("blikInstructions")}</p>
                <Input
                  placeholder="123456"
                  value={blikCode}
                  onChange={(e) => {
                    // Only allow digits, max 6
                    const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setBlikCode(val);
                  }}
                  className="text-center text-3xl font-mono tracking-[0.5em] h-16"
                  maxLength={6}
                />
                <p className="text-xs text-muted-foreground text-center">
                  {blikCode.length}/6 digits
                </p>
              </CardContent>
            </Card>

            {error && <p className="text-sm text-destructive mt-4">{error}</p>}

            <div className="flex gap-3 mt-6">
              <Button variant="outline" onClick={() => setStep("select-method")} className="flex-1">
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button
                className="flex-1"
                disabled={blikCode.length < 6 || loading}
                onClick={() => handleCreatePurchase()}
              >
                {loading ? "..." : t("submitBlik")} <ArrowRight className="h-4 w-4 ml-2" />
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
                <CardContent className="p-8 text-center space-y-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                  >
                    <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
                  </motion.div>
                  <h3 className="text-xl font-bold text-green-500">Payment Approved!</h3>
                  <p className="text-muted-foreground">
                    {paymentResult.credits} credits have been added to your balance.
                  </p>
                  <div className="flex gap-3 pt-4">
                    <Button
                      className="flex-1"
                      onClick={() => router.push("/")}
                    >
                      Browse Models
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
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
                      Buy More Credits
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Payment Rejected */}
            {paymentStatus === "REJECTED" && (
              <Card className="border-destructive/50">
                <CardContent className="p-8 text-center space-y-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                  >
                    <XCircle className="h-16 w-16 text-destructive mx-auto" />
                  </motion.div>
                  <h3 className="text-xl font-bold text-destructive">Payment Rejected</h3>
                  <p className="text-muted-foreground">
                    Your payment was not approved. Please try again or contact support.
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
                    Try Again
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Pending / Waiting */}
            {(!paymentStatus || paymentStatus === "PENDING" || paymentStatus === "EXPIRED") && (
            <Card>
              <CardHeader className="text-center">
                <CardTitle className="flex items-center justify-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  {t("pending")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Countdown */}
                <PaymentCountdown
                  expirationTime={paymentResult.expirationTime}
                  isBlik={paymentResult.paymentMethod === "BLIK"}
                  onBlikExpired={() => {
                    // Show new BLIK code input
                  }}
                />

                {/* Transaction code */}
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">{t("transactionCode")}</p>
                  <p className="text-2xl font-mono font-bold mt-1">{paymentResult.transactionCode}</p>
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

                {/* BLIK expired: enter new code */}
                {paymentResult.paymentMethod === "BLIK" && (
                  <div className="space-y-3 border-t border-border pt-4">
                    <p className="text-sm font-medium">{t("blikExpiredNewCode")}</p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="123456"
                        value={blikCode}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                          setBlikCode(val);
                        }}
                        className="flex-1 text-center font-mono text-lg"
                        maxLength={6}
                      />
                      <Button
                        onClick={handleBlikExpiredNewCode}
                        disabled={blikCode.length < 6 || loading}
                        size="sm"
                      >
                        {t("submitNewBlik")}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Crypto wallet */}
                {paymentResult.walletAddress && (
                  <div className="space-y-3">
                    <div className="p-4 rounded-xl bg-secondary border border-border">
                      <p className="text-sm text-muted-foreground">{t("walletAddress")}</p>
                      <p className="text-sm font-mono mt-1 break-all">{paymentResult.walletAddress}</p>
                    </div>
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

                {/* Amount */}
                <div className="flex justify-between text-sm border-t border-border pt-4">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-semibold">{formatPrice(paymentResult.amount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Credits</span>
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
                      Proof uploaded successfully
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={proofUploading}
                      onClick={() => proofInputRef.current?.click()}
                    >
                      {proofUploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      {proofUploading ? "Uploading..." : t("uploadProof")}
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    JPEG, PNG, WebP, GIF, PDF &middot; Max 10 MB
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
                  New Purchase
                </Button>
              </CardContent>
            </Card>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
