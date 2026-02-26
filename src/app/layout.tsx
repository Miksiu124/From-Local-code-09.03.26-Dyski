import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/providers";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { ErrorBoundary } from "@/components/error-boundary";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"] });

const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || "https://contentvault.io").replace(/\/+$/, "");

export const metadata: Metadata = {
  title: {
    default: "ContentVault – Premium Content Platform",
    template: "%s | ContentVault",
  },
  description:
    "Browse exclusive premium content from top creators. Instant access, multiple payment methods, and a curated library updated daily.",
  keywords: ["premium content", "creators", "exclusive", "videos", "photos", "ContentVault"],
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
    siteName: "ContentVault",
    title: "ContentVault – Premium Content Platform",
    description:
      "Browse exclusive premium content from top creators. Instant access, multiple payment methods.",
    locale: "en_US",
    alternateLocale: ["pl_PL"],
    url: baseUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: "ContentVault – Premium Content Platform",
    description:
      "Browse exclusive premium content from top creators.",
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
              name: "ContentVault",
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
            <main className="flex-1">
              <ErrorBoundary>{children}</ErrorBoundary>
            </main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
