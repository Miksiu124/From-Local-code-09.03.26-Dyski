"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { ShoppingCart, Calendar, CreditCard, Box, ExternalLink, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import { formatCredits } from "@/lib/utils";

interface Purchase {
    id: string;
    purchaseType: "INDIVIDUAL_MODEL" | "BUNDLE";
    modelName?: string;
    folderName?: string;
    creditsSpent: number;
    createdAt: string;
    expiresAt?: string;
    isActive: boolean;
}

interface CreditPurchase {
    id: string;
    amount: number;
    credits: number;
    status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
    paymentMethod: string;
    createdAt: string;
}

export default function MyPurchasesPage() {
    const t = useTranslations("common");
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [creditPurchases, setCreditPurchases] = useState<CreditPurchase[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [purchasesRes, creditPurchasesRes] = await Promise.all([
                    fetch("/api/purchases"),
                    fetch("/api/credits/purchase")
                ]);

                if (purchasesRes.ok) {
                    const data = await purchasesRes.json();
                    setPurchases(data);
                }

                if (creditPurchasesRes.ok) {
                    const data = await creditPurchasesRes.json();
                    setCreditPurchases(data);
                }

            } catch (error) {
                console.error("Failed to fetch purchases", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    if (loading) {
        return (
            <div className="container mx-auto px-4 py-12 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8 space-y-8">
            <div className="slide-up">
                <h1 className="text-2xl sm:text-3xl font-bold mb-2">My Purchases</h1>
                <p className="text-sm text-muted-foreground">Manage your content access and credit history.</p>
            </div>

            {/* Content Access */}
            <div className="slide-up" style={{ animationDelay: "0.1s" }}>
                <Card className="border-white/[0.06]">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                <Box className="h-4 w-4 text-primary" />
                            </div>
                            Content Access
                        </CardTitle>
                        <CardDescription>Models and bundles you have purchased access to.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {purchases.length === 0 ? (
                            <div className="text-center py-10 text-muted-foreground">
                                <div className="mx-auto h-14 w-14 rounded-2xl bg-white/[0.03] flex items-center justify-center mb-3">
                                    <Box className="h-6 w-6 opacity-30" />
                                </div>
                                <p className="text-sm font-medium">No content purchased yet</p>
                            </div>
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {purchases.map((purchase) => (
                                    <div key={purchase.id} className="flex flex-col border border-white/[0.06] rounded-xl p-4 bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                                        <div className="flex justify-between items-start mb-3">
                                            <h3 className="font-semibold text-base">{purchase.modelName || "All Models Bundle"}</h3>
                                            <Badge variant={purchase.isActive ? "success" : "secondary"} className="text-[10px] shrink-0">
                                                {purchase.isActive ? "Active" : "Expired"}
                                            </Badge>
                                        </div>

                                        <div className="space-y-1.5 text-xs text-muted-foreground flex-1 mb-4">
                                            <div className="flex items-center gap-2">
                                                <CreditCard className="h-3.5 w-3.5" />
                                                <span>{formatCredits(purchase.creditsSpent)} credits</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Calendar className="h-3.5 w-3.5" />
                                                <span>Purchased: {new Date(purchase.createdAt).toLocaleDateString()}</span>
                                            </div>
                                            {purchase.expiresAt && (
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="h-3.5 w-3.5" />
                                                    <span>Expires: {new Date(purchase.expiresAt).toLocaleDateString()}</span>
                                                </div>
                                            )}
                                        </div>

                                        {purchase.isActive && purchase.purchaseType === "INDIVIDUAL_MODEL" && purchase.folderName && (
                                            <Link href={`/models/${purchase.folderName}`} className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}>
                                                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                                                View Content
                                            </Link>
                                        )}
                                        {purchase.isActive && purchase.purchaseType === "BUNDLE" && (
                                            <Link href="/" className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}>
                                                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                                                Browse Models
                                            </Link>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Credit History */}
            <div className="slide-up" style={{ animationDelay: "0.2s" }}>
                <Card className="border-white/[0.06]">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                <ShoppingCart className="h-4 w-4 text-primary" />
                            </div>
                            Credit History
                        </CardTitle>
                        <CardDescription>History of your credit package purchases.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {creditPurchases.length === 0 ? (
                            <div className="text-center py-10 text-muted-foreground">
                                <div className="mx-auto h-14 w-14 rounded-2xl bg-white/[0.03] flex items-center justify-center mb-3">
                                    <ShoppingCart className="h-6 w-6 opacity-30" />
                                </div>
                                <p className="text-sm font-medium">No credit purchase history</p>
                            </div>
                        ) : (
                            <>
                                {/* Desktop table */}
                                <div className="overflow-x-auto hidden sm:block">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-white/[0.06] text-left">
                                                <th className="py-2.5 px-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">Date</th>
                                                <th className="py-2.5 px-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">Amount</th>
                                                <th className="py-2.5 px-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">Credits</th>
                                                <th className="py-2.5 px-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">Method</th>
                                                <th className="py-2.5 px-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {creditPurchases.map((cp) => (
                                                <tr key={cp.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                                                    <td className="py-3 px-4 text-muted-foreground">{new Date(cp.createdAt).toLocaleDateString()}</td>
                                                    <td className="py-3 px-4">${cp.amount.toFixed(2)}</td>
                                                    <td className="py-3 px-4 font-medium text-primary">+{cp.credits}</td>
                                                    <td className="py-3 px-4 text-muted-foreground">{cp.paymentMethod}</td>
                                                    <td className="py-3 px-4">
                                                        <Badge variant={
                                                            cp.status === 'APPROVED' ? 'success' :
                                                                cp.status === 'PENDING' ? 'warning' :
                                                                    cp.status === 'REJECTED' ? 'destructive' : 'secondary'
                                                        } className="text-[10px]">
                                                            {cp.status}
                                                        </Badge>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {/* Mobile cards */}
                                <div className="flex flex-col gap-3 sm:hidden">
                                    {creditPurchases.map((cp) => (
                                        <div key={cp.id} className="border border-white/[0.06] rounded-xl p-3.5">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="font-medium text-primary text-sm">+{cp.credits} credits</span>
                                                <Badge variant={
                                                    cp.status === 'APPROVED' ? 'success' :
                                                        cp.status === 'PENDING' ? 'warning' :
                                                            cp.status === 'REJECTED' ? 'destructive' : 'secondary'
                                                } className="text-[10px]">
                                                    {cp.status}
                                                </Badge>
                                            </div>
                                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                <span>${cp.amount.toFixed(2)} · {cp.paymentMethod}</span>
                                                <span>{new Date(cp.createdAt).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
