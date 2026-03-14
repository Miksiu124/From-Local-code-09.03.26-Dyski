"use client";

import { Suspense } from "react";
import { NextIntlClientProvider } from "next-intl";
import { LazyMotion, domAnimation } from "framer-motion";
import { ReferralCookieProvider } from "@/components/referral-cookie-provider";

interface ProvidersProps {
  children: React.ReactNode;
  locale: string;
  messages: Record<string, unknown>;
  timeZone?: string;
}

export function Providers({ children, locale, messages, timeZone }: ProvidersProps) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone={timeZone || "UTC"}
    >
      <LazyMotion features={domAnimation}>
        <Suspense fallback={null}>
          <ReferralCookieProvider />
        </Suspense>
        {children}
      </LazyMotion>
    </NextIntlClientProvider>
  );
}
