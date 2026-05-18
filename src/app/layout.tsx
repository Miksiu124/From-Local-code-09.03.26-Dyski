import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { Libre_Baskerville, Manrope } from "next/font/google";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/providers";
import { Header } from "@/components/layout/header";
import { ConditionalFooter } from "@/components/layout/conditional-footer";
import { CookieBanner } from "@/components/cookie-banner";
import { SkipToMainLink } from "@/components/layout/skip-to-main";
import { ErrorBoundary } from "@/components/error-boundary";
import { ClientErrorReporter } from "@/components/client-error-reporter";
import { GrowthFunnelChrome } from "@/components/growth/growth-funnel-chrome";
import { ReferralProgramModal } from "@/components/growth/referral-program-modal";
import { ReferralProgramNudge } from "@/components/growth/referral-program-nudge";
import { PostAuthGuideAutostart } from "@/components/onboarding/post-auth-guide-autostart";
import { ProductTourAutostart } from "@/components/onboarding/product-tour-autostart";
import { FluidCanvasBackdrop } from "@/components/layout/fluid-canvas-backdrop";
import { getSiteUrl } from "@/lib/site-url";
import "./globals.css";

/** UI sans — not a “reflex” training default; clear weights for hierarchy */
const manrope = Manrope({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-manrope",
  weight: ["400", "500", "600", "700"],
});

/** Display serif for page titles / hero — editorial contrast vs. UI sans */
const libreDisplay = Libre_Baskerville({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-libre-display",
  weight: ["400", "700"],
});

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  title: {
    default: "Dyskiof – Premium Content Platform",
    template: "%s | Dyskiof",
  },
  description:
    "Browse exclusive premium content from top creators. Instant access, secure payments, and a curated library updated daily. Join Dyskiof today.",
  keywords: ["Dyskiof", "dyskiof.net", "premium content", "creators", "exclusive", "videos", "photos"],
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "Dyskiof",
    title: "Dyskiof – Premium Content Platform",
    description:
      "Browse exclusive premium content from top creators. Instant access, multiple payment methods.",
    locale: "en_US",
    url: siteUrl,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Dyskiof – Premium Content Platform" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Dyskiof – Premium Content Platform",
    description:
      "Browse exclusive premium content from top creators.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang={locale} className={`dark ${manrope.variable} ${libreDisplay.variable}`}>
      <head>
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "Dyskiof",
              url: siteUrl,
              description: "Browse exclusive premium content from top creators.",
              potentialAction: {
                "@type": "SearchAction",
                target: `${siteUrl}/?search={search_term_string}`,
                "query-input": "required name=search_term_string",
              },
            }),
          }}
        />
      </head>
      <body
        className={`${manrope.className} min-h-screen bg-background text-base text-foreground antialiased leading-[1.62]`}
      >
        <Providers
          locale={locale}
          messages={messages as Record<string, unknown>}
          timeZone="UTC"
        >
          <FluidCanvasBackdrop />
          <div className="relative z-10 flex min-h-screen w-full min-w-0 flex-col overflow-x-clip">
            <SkipToMainLink />
            <Header />
            <Suspense fallback={null}>
              <ReferralProgramModal />
            </Suspense>
            <ReferralProgramNudge />
            <main
              id="main"
              className="flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] sm:pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-0"
            >
              <ErrorBoundary>{children}</ErrorBoundary>
            </main>
            <ConditionalFooter />
            <CookieBanner />
            <ClientErrorReporter />
            <GrowthFunnelChrome />
            <PostAuthGuideAutostart />
            <ProductTourAutostart />
          </div>
        </Providers>
      </body>
    </html>
  );
}
