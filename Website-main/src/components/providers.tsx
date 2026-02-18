"use client";

import { NextIntlClientProvider } from "next-intl";
import { LazyMotion, domAnimation } from "framer-motion";

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
        {children}
      </LazyMotion>
    </NextIntlClientProvider>
  );
}
