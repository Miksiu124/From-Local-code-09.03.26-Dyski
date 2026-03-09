"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import {
  UserPlus,
  Copy,
  Check,
  Loader2,
  Coins,
  Users,
  ShoppingBag,
  Gift,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCredits } from "@/lib/utils";
import { logger } from "@/lib/logger";

type ReferralData = {
  referralCode: string;
  referralLink: string;
  stats: {
    totalReferred: number;
    totalPurchased: number;
    totalCreditsEarned: number;
  };
  recentCredits: Array<{ credits: number; email: string; at: string }>;
  bonuses?: {
    creditsReferrer: number;
    bonusPercentReferee: number;
  };
};

export function ReferralPanel() {
  const t = useTranslations("referral");
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/referral/me", { credentials: "include" });
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (err) {
        logger.error("Failed to fetch referral data", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleCopy = async () => {
    if (!data?.referralLink) return;
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    try {
      await navigator.clipboard.writeText(data.referralLink);
      setCopied(true);
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch (err) {
      logger.error("Copy failed", err);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <p className="text-muted-foreground">Failed to load referral data.</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative space-y-6"
    >
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
          <UserPlus className="h-7 w-7 text-primary" />
          {t("title")}
        </h1>
        <p className="mt-2 text-muted-foreground">{t("description")}</p>
      </div>

      <Card className="border-white/[0.08] bg-card shadow-lg shadow-black/20">
        <CardHeader>
          <CardTitle className="text-lg">{t("yourLink")}</CardTitle>
          <CardDescription>{t("shareLink")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              readOnly
              value={data.referralLink}
              className="bg-secondary border-white/[0.08] font-mono text-sm"
            />
            <Button
              onClick={handleCopy}
              className="shrink-0 min-w-[44px] min-h-[44px]"
              variant="outline"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("codeLabel")}: <code className="bg-secondary px-1.5 py-0.5 rounded">{data.referralCode}</code>
          </p>
        </CardContent>
      </Card>

      <Card className="border-white/[0.08] bg-card shadow-lg shadow-black/20">
        <CardHeader>
          <CardTitle className="text-lg">{t("stats")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="rounded-xl bg-card border border-white/[0.08] p-4">
              <Users className="h-5 w-5 text-primary mb-2" />
              <p className="text-2xl font-bold">{data.stats.totalReferred}</p>
              <p className="text-xs text-muted-foreground">{t("totalReferred")}</p>
            </div>
            <div className="rounded-xl bg-card border border-white/[0.08] p-4">
              <ShoppingBag className="h-5 w-5 text-primary mb-2" />
              <p className="text-2xl font-bold">{data.stats.totalPurchased}</p>
              <p className="text-xs text-muted-foreground">{t("totalPurchased")}</p>
            </div>
            <div className="rounded-xl bg-card border border-white/[0.08] p-4">
              <Coins className="h-5 w-5 text-primary mb-2" />
              <p className="text-2xl font-bold">{formatCredits(data.stats.totalCreditsEarned)}</p>
              <p className="text-xs text-muted-foreground">{t("totalCreditsEarned")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {data.recentCredits.length > 0 && (
        <Card className="border-white/[0.08] bg-card shadow-lg shadow-black/20">
          <CardHeader>
            <CardTitle className="text-lg">{t("recentCredits")}</CardTitle>
            <CardDescription>{t("recentCreditsDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {data.recentCredits.map((rc, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between py-2 border-b border-white/[0.06] last:border-0"
                >
                  <span className="text-sm truncate">{rc.email || t("unknown")}</span>
                  <span className="text-sm font-medium text-primary shrink-0 ml-2">
                    +{formatCredits(rc.credits)} {t("credits")}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <Gift className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">{t("howItWorks")}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {data.bonuses ? (
                  t("howItWorksDescWithBonuses", {
                    creditsReferrer: data.bonuses.creditsReferrer,
                    bonusPercentReferee: data.bonuses.bonusPercentReferee,
                  })
                ) : (
                  t("howItWorksDesc")
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
