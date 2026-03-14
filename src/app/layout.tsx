import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/providers";
import { Header } from "@/components/layout/header";
import { ConditionalFooter } from "@/components/layout/conditional-footer";
import { CookieBanner } from "@/components/cookie-banner";
import { ErrorBoundary } from "@/components/error-boundary";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"] });

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
            <Header />
            <main className="flex-1 pb-24 md:pb-0">
              <ErrorBoundary>{children}</ErrorBoundary>
            </main>
            <ConditionalFooter />
            <CookieBanner />
          </div>
        </Providers>
      </body>
    </html>
  );
}
