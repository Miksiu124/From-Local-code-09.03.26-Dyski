import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/providers";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { ErrorBoundary } from "@/components/error-boundary";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ContentVault",
  description: "Premium content sharing platform",
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
