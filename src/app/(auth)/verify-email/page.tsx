"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Mail, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function VerifyEmailPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const error = searchParams.get("error");

  useEffect(() => {
    if (token && !error) {
      window.location.href = `/api/auth/verify-email?token=${encodeURIComponent(token)}`;
    }
  }, [token, error]);

  if (token && !error) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4 py-8">
        <div className="absolute inset-0 hero-gradient pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md relative flex flex-col items-center gap-4"
        >
          <div className="h-12 w-12 rounded-2xl bg-primary/20 flex items-center justify-center">
            <Mail className="h-6 w-6 text-primary animate-pulse" />
          </div>
          <p className="text-muted-foreground text-sm">Verifying your email...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 py-8">
      <div className="absolute inset-0 hero-gradient pointer-events-none" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
        className="w-full max-w-md relative"
      >
        <Card className="border-white/[0.06] bg-card/80 backdrop-blur-xl">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center">
              <AlertCircle className="h-5 w-5 text-destructive" />
            </div>
            <CardTitle className="text-2xl font-bold">
              {error === "invalid_token" || error === "missing_token"
                ? t("verifyEmailInvalidTitle")
                : t("verifyEmailErrorTitle")}
            </CardTitle>
            <CardDescription className="mt-2">
              {error === "invalid_token" || error === "missing_token"
                ? t("verifyEmailInvalidDesc")
                : t("verifyEmailErrorDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Link href="/login" className="block">
              <Button className="w-full h-11">{t("loginTitle")}</Button>
            </Link>
            <Link href="/register" className="block">
              <Button variant="outline" className="w-full h-11">
                {t("registerTitle")}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
