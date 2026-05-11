"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { logger } from "@/lib/logger";

export default function AdminError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const t = useTranslations("admin");

    useEffect(() => {
        logger.error("Admin error boundary caught error:", error);
    }, [error]);

    return (
        <div className="flex items-center justify-center min-h-[50vh] p-4">
            <Card className="max-w-md w-full border-destructive/50 shadow-lg">
                <CardHeader className="text-center">
                    <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
                        <AlertTriangle className="h-6 w-6 text-destructive" />
                    </div>
                    <CardTitle className="text-xl">Something went wrong</CardTitle>
                    <CardDescription>
                        {error.message || "An unexpected error occurred while loading this page."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="text-center text-sm text-muted-foreground">
                    <p>The application encountered an error. You can try refreshing the page or navigating back to the dashboard.</p>
                    {error.digest && (
                        <p className="mt-2 text-xs font-mono bg-muted p-1 rounded">
                            Error Digest: {error.digest}
                        </p>
                    )}
                </CardContent>
                <CardFooter className="flex justify-center gap-4">
                    <Button variant="outline" onClick={() => window.location.href = "/admin/payments"}>
                        <Home className="mr-2 h-4 w-4" />
                        Dashboard
                    </Button>
                    <Button onClick={reset}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Try Again
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}
