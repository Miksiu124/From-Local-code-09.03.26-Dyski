"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock, UserPlus, Coins, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatCredits } from "@/lib/utils";

interface AccessRequiredPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId?: string;
  modelName?: string;
  cost7d?: number;
  cost30d?: number;
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
  isAuthenticated,
  initialCreditBalance = 0,
}: AccessRequiredPopupProps) {
  const t = useTranslations("popup");
  const router = useRouter();
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState("");
  const [creditBalance, setCreditBalance] = useState(initialCreditBalance);

  // Fetch real credit balance from DB when popup opens
  useEffect(() => {
    if (!open || !isAuthenticated) return;
    const fetchBalance = async () => {
      try {
        const res = await fetch("/api/user/balance");
        if (res.ok) {
          const data = await res.json();
          setCreditBalance(data.creditBalance);
        }
      } catch {
        // Fallback to initial value
      }
    };
    fetchBalance();
  }, [open, isAuthenticated]);

  const hasEnoughFor7d = creditBalance >= cost7d && cost7d > 0;
  const hasEnoughFor30d = creditBalance >= cost30d && cost30d > 0;
  const hasEnoughCredits = hasEnoughFor7d || hasEnoughFor30d;

  const handlePurchase = async (duration: "SEVEN_DAYS" | "THIRTY_DAYS") => {
    if (!modelId) return;
    setPurchasing(true);
    setError("");

    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, accessDuration: duration }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMessage = data.error?.message || data.error || "Purchase failed";
        setError(errorMessage);
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

  // State 1: Not authenticated -> sign in / register
  if (!isAuthenticated) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-7 w-7 text-primary" />
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

  // State 2: Authenticated but not enough credits -> buy credits
  if (!hasEnoughCredits) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Coins className="h-7 w-7 text-primary" />
          </div>
          <DialogTitle className="text-center text-xl">{t("accessRequired")}</DialogTitle>
          <DialogDescription className="text-center">
            {t("insufficientCredits")}
          </DialogDescription>
        </DialogHeader>
        <div className="text-center text-sm text-muted-foreground mb-2">
          {t("yourBalance", { balance: formatCredits(creditBalance) })}
        </div>
        <DialogFooter>
          <Link href="/purchase" className="w-full" onClick={() => onOpenChange(false)}>
            <Button className="w-full">
              <Coins className="h-4 w-4 mr-2" />
              {t("buyCredits")}
            </Button>
          </Link>
        </DialogFooter>
      </Dialog>
    );
  }

  // State 3: Authenticated with enough credits -> unlock with 7d/30d picker
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Lock className="h-7 w-7 text-primary" />
        </div>
        <DialogTitle className="text-center text-xl">
          {t("unlockAccess")}
        </DialogTitle>
        <DialogDescription className="text-center">
          {modelName ? `Unlock "${modelName}"` : t("unlockModel")}
        </DialogDescription>
      </DialogHeader>

      <div className="text-center text-sm text-muted-foreground mb-4">
        {t("yourBalance", { balance: formatCredits(creditBalance) })}
      </div>

      <div className="flex flex-col gap-3 px-1">
        {hasEnoughFor7d && (
          <Button
            variant="outline"
            className="w-full justify-between h-14 px-4"
            disabled={purchasing}
            onClick={() => handlePurchase("SEVEN_DAYS")}
          >
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>7 Days Access</span>
            </div>
            <span className="font-semibold text-primary">{cost7d} Credits</span>
          </Button>
        )}
        {hasEnoughFor30d && (
          <Button
            variant="default"
            className="w-full justify-between h-14 px-4"
            disabled={purchasing}
            onClick={() => handlePurchase("THIRTY_DAYS")}
          >
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>30 Days Access</span>
            </div>
            <span className="font-semibold">{cost30d} Credits</span>
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive text-center mt-2">{error}</p>}

      <DialogFooter className="mt-2">
        <Button
          variant="ghost"
          className="w-full text-muted-foreground"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
