import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/providers";
import { Header } from "@/components/layout/header";
import { ConditionalFooter } from "@/components/layout/conditional-footer";
import { CookieBanner } from "@/components/cookie-banner";
import { ErrorBoundary } from "@/components/error-boundary";
import { ClientErrorReporter } from "@/components/client-error-reporter";
import { GrowthFunnelChrome } from "@/components/growth/growth-funnel-chrome";
import { ReferralProgramNudge } from "@/components/growth/referral-program-nudge";
import { PostAuthGuideAutostart } from "@/components/onboarding/post-auth-guide-autostart";
import { ProductTourAutostart } from "@/components/onboarding/product-tour-autostart";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  display: "swap", // Prevent FOIT, show text immediately with fallback font
});

const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || "https://dyskiof.net").replace(/\/+$/, "");

export const metadata: Metadata = {
  title: {
    default: "Dyskiof – Premium Content Platform",
    template: "%s | Dyskiof",
  },
  description:
    "Browse exclusive premium content from top creators. Instant access, secure payments, and a curated library updated daily. Join Dyskiof today.",
  keywords: ["Dyskiof", "dyskiof.net", "premium content", "creators", "exclusive", "videos", "photos"],
  metadataBase: new URL(baseUrl),
  alternates: {
    canonical: baseUrl,
    languages: {
      en: baseUrl,
      pl: baseUrl,
    },
  },
  openGraph: {
    type: "website",
    siteName: "Dyskiof",
    title: "Dyskiof – Premium Content Platform",
    description:
      "Browse exclusive premium content from top creators. Instant access, multiple payment methods.",
    locale: "en_US",
    alternateLocale: ["pl_PL"],
    url: baseUrl,
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

  return (
    <html lang={locale} className="dark">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "Dyskiof",
              url: baseUrl,
              description: "Browse exclusive premium content from top creators.",
              potentialAction: {
                "@type": "SearchAction",
                target: `${baseUrl}/?search={search_term_string}`,
                "query-input": "required name=search_term_string",
              },
            }),
          }}
        />
      </head>
      <body className={`${outfit.className} min-h-screen bg-background text-foreground antialiased`} >
        <Providers
          locale={locale}
          messages={messages as Record<string, unknown>}
          timeZone="UTC"
        >
          <div className="flex min-h-screen flex-col">
            <a
              href="#main"
              className="absolute left-4 top-4 z-[100] px-4 py-2 bg-primary text-primary-foreground rounded-xl -translate-y-[200%] focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-ring transition-transform duration-150"
            >
              Skip to main content
            </a>
            <Header />
            <ReferralProgramNudge />
            <main id="main" className="flex-1 pb-24 md:pb-0">
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
