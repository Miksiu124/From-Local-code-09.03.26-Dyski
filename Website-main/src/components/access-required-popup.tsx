"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock, UserPlus, Coins, Clock, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatCredits } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface AccessRequiredPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId?: string;
  modelName?: string;
  cost7d?: number;
  cost30d?: number;
  isBundle?: boolean;
  bundleCost14d?: number;
  bundleCost30d?: number;
  isAuthenticated: boolean;
  initialCreditBalance?: number;
}

export function AccessRequiredPopup({
  open,
  onOpenChange,
  modelId,
  modelName,
  cost7d = 0,
  cost30d = 0,
  isBundle = false,
  bundleCost14d = 0,
  bundleCost30d = 0,
  isAuthenticated,
  initialCreditBalance = 0,
}: AccessRequiredPopupProps) {
  const t = useTranslations("popup");
  const router = useRouter();
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState("");
  const [insufficientCredits, setInsufficientCredits] = useState(false);
  const [realBalance, setRealBalance] = useState(initialCreditBalance);
  const [selectedDuration, setSelectedDuration] = useState<string | null>(null);

  const resetState = () => {
    setError("");
    setInsufficientCredits(false);
    setPurchasing(false);
    setSelectedDuration(null);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) resetState();
    onOpenChange(v);
  };

  const handleConfirmPurchase = async () => {
    if (!selectedDuration) return;

    if (!isAuthenticated) {
      onOpenChange(false);
      router.push("/login");
      return;
    }

    setPurchasing(true);
    setError("");
    setInsufficientCredits(false);

    try {
      const balanceRes = await fetch("/api/user/balance");
      if (balanceRes.ok) {
        const data = await balanceRes.json();
        setRealBalance(data.creditBalance);

        let needed = 0;
        if (isBundle) {
          needed = selectedDuration === "FOURTEEN_DAYS" ? bundleCost14d : bundleCost30d;
        } else {
          needed = selectedDuration === "SEVEN_DAYS" ? cost7d : cost30d;
        }

        if (data.creditBalance < needed) {
          setInsufficientCredits(true);
          setPurchasing(false);
          return;
        }
      }

      const body = isBundle
        ? { modelId: null, accessDuration: selectedDuration }
        : { modelId, accessDuration: selectedDuration };

      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const resData = await res.json();

      if (!res.ok) {
        setError(resData.error?.message || resData.error || "Purchase failed");
        return;
      }

      onOpenChange(false);
      router.refresh();
    } catch {
      setError("Purchase failed. Please try again.");
    } finally {
      setPurchasing(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-purple-600/15 border border-primary/15">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center text-xl">{t("accessRequired")}</DialogTitle>
          <DialogDescription className="text-center">
            {t("signInFirst")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <Link href="/login" className="flex-1" onClick={() => onOpenChange(false)}>
              <Button variant="outline" className="w-full">
                <UserPlus className="h-4 w-4 mr-2" />
                {t("signIn")}
              </Button>
            </Link>
            <Link href="/register" className="flex-1" onClick={() => onOpenChange(false)}>
              <Button className="w-full">
                {t("createAccount")}
              </Button>
            </Link>
          </div>
        </DialogFooter>
      </Dialog>
    );
  }

  const title = isBundle ? t("unlockAllModels") : (modelName ? t("unlockModel") : t("unlockAccess"));
  const subtitle = isBundle
    ? t("bundleDescription")
    : t("chooseAccessPlan");

  const option1 = isBundle
    ? { duration: "FOURTEEN_DAYS", label: `14 ${t("days")}`, cost: bundleCost14d }
    : { duration: "SEVEN_DAYS", label: `7 ${t("days")}`, cost: cost7d };

  const option2 = isBundle
    ? { duration: "THIRTY_DAYS", label: `30 ${t("days")}`, cost: bundleCost30d }
    : { duration: "THIRTY_DAYS", label: `30 ${t("days")}`, cost: cost30d };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogHeader>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-purple-600/15 border border-primary/15">
          <Lock className="h-6 w-6 text-primary" />
        </div>
        <DialogTitle className="text-center text-xl">{title}</DialogTitle>
        <DialogDescription className="text-center">
          {subtitle}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3 px-1 mt-2">
        {option1.cost > 0 && (
          <button
            type="button"
            className={cn(
              "w-full flex items-center justify-between h-14 px-4 rounded-xl border-2 transition-all cursor-pointer press-effect",
              selectedDuration === option1.duration
                ? "border-primary bg-primary/10"
                : "border-white/[0.08] hover:border-primary/30 bg-transparent"
            )}
            disabled={purchasing}
            onClick={() => setSelectedDuration(option1.duration)}
          >
            <div className="flex items-center gap-2">
              {selectedDuration === option1.duration ? (
                <Check className="h-4 w-4 text-primary" />
              ) : (
                <Clock className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="font-medium">{option1.label}</span>
            </div>
            <span className="font-semibold text-primary">{option1.cost} {t("credits")}</span>
          </button>
        )}
        {option2.cost > 0 && (
          <button
            type="button"
            className={cn(
              "w-full flex items-center justify-between h-14 px-4 rounded-xl border-2 transition-all cursor-pointer press-effect",
              selectedDuration === option2.duration
                ? "border-primary bg-primary/10"
                : "border-white/[0.08] hover:border-primary/30 bg-transparent"
            )}
            disabled={purchasing}
            onClick={() => setSelectedDuration(option2.duration)}
          >
            <div className="flex items-center gap-2">
              {selectedDuration === option2.duration ? (
                <Check className="h-4 w-4 text-primary" />
              ) : (
                <Clock className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="font-medium">{option2.label}</span>
            </div>
            <span className="font-semibold text-primary">{option2.cost} {t("credits")}</span>
          </button>
        )}
      </div>

      <div className="min-h-[48px] mt-3">
        {purchasing && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("processing")}
          </div>
        )}

        {insufficientCredits && (
          <div className="rounded-xl border border-yellow-500/15 bg-yellow-500/5 p-4 text-center">
            <p className="text-sm text-yellow-200 mb-2">
              {t("insufficientCredits")}
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              {t("yourBalance", { balance: formatCredits(realBalance) })}
            </p>
            <Link href="/purchase" onClick={() => onOpenChange(false)}>
              <Button size="sm">
                <Coins className="h-4 w-4 mr-2" />
                {t("buyCredits")}
              </Button>
            </Link>
          </div>
        )}

        {error && <p className="text-sm text-destructive text-center">{error}</p>}
      </div>

      <DialogFooter className="mt-2">
        <div className="flex w-full flex-col gap-2">
          <Button
            className="w-full h-12"
            disabled={!selectedDuration || purchasing}
            onClick={handleConfirmPurchase}
          >
            {purchasing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Coins className="h-4 w-4 mr-2" />
            )}
            {selectedDuration
              ? `${t("confirm")} — ${selectedDuration === option1.duration ? option1.cost : option2.cost} ${t("credits")}`
              : t("chooseAccessPlan")}
          </Button>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={() => handleOpenChange(false)}
          >
            {t("cancel")}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  );
}
