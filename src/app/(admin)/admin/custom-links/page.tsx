"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Plus, Edit, Trash2, LineChart, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { logger } from "@/lib/logger";

interface CustomLink {
    id: string;
    slug: string;
    destination: string;
    description: string | null;
    isActive: boolean;
    createdAt: string;
    visitsCount: number;
}

export default function AdminCustomLinksPage() {
    const t = useTranslations("admin");
    const [links, setLinks] = useState<CustomLink[]>([]);
    const [loading, setLoading] = useState(true);

    // Create/Edit Dialog
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingLink, setEditingLink] = useState<CustomLink | null>(null);
    const [form, setForm] = useState({
        slug: "",
        destination: "",
        description: "",
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    // Analytics Dialog
    const [analyticsOpen, setAnalyticsOpen] = useState(false);
    const [selectedLink, setSelectedLink] = useState<CustomLink | null>(null);
    const [analyticsData, setAnalyticsData] = useState<{ daily: any[]; referers: any[] } | null>(null);
    const [loadingAnalytics, setLoadingAnalytics] = useState(false);

    useEffect(() => {
        fetchLinks();
    }, []);

    const fetchLinks = async () => {
        try {
            const res = await fetch("/api/admin/custom-links", { credentials: "include" });
            if (res.ok) {
                setLinks(await res.json());
            }
        } catch (err) {
            logger.error("Failed to fetch custom links", err);
        } finally {
            setLoading(false);
        }
    };

    const openCreate = () => {
        setEditingLink(null);
        setForm({
            slug: "",
            destination: "",
            description: "",
        });
        setError("");
        setDialogOpen(true);
    };

    const openEdit = (link: CustomLink) => {
        setEditingLink(link);
        setForm({
            slug: link.slug,
            destination: link.destination,
            description: link.description || "",
        });
        setError("");
        setDialogOpen(true);
    };

    const handleSave = async () => {
        setError("");
        setSaving(true);
        try {
            const payload = {
                slug: form.slug.trim(),
                destination: form.destination.trim(),
                description: form.description.trim() || null,
            };

            const url = editingLink
                ? `/api/admin/custom-links/${editingLink.id}`
                : "/api/admin/custom-links";
            const method = editingLink ? "PATCH" : "POST";

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(payload),
            });

            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setDialogOpen(false);
                fetchLinks();
            } else {
                setError(data.message || data.error || "Failed to save");
            }
        } catch (err) {
            logger.error("Failed to save custom link", err);
            setError("Failed to save");
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (link: CustomLink) => {
        try {
            const res = await fetch(`/api/admin/custom-links/${link.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ isActive: !link.isActive }),
            });
            if (res.ok) fetchLinks();
        } catch (err) {
            logger.error("Failed to toggle link status", err);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this custom link?")) return;
        try {
            const res = await fetch(`/api/admin/custom-links/${id}`, {
                method: "DELETE",
                credentials: "include",
            });
            if (res.ok) fetchLinks();
        } catch (err) {
            logger.error("Failed to delete link", err);
        }
    };

    const openAnalytics = async (link: CustomLink) => {
        setSelectedLink(link);
        setAnalyticsOpen(true);
        setLoadingAnalytics(true);
        setAnalyticsData(null);
        try {
            const res = await fetch(`/api/admin/custom-links/${link.id}/analytics`, { credentials: "include" });
            if (res.ok) {
                const data = await res.json();
                setAnalyticsData(data);
            }
        } catch (err) {
            logger.error("Failed to load analytics", err);
        } finally {
            setLoadingAnalytics(false);
        }
    };

    if (loading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;

    return (
        <div className="space-y-6 max-w-7xl mx-auto p-4 lg:p-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold">{t("customLinks")}</h1>
                    <p className="text-sm text-muted-foreground">{t("customLinksDesc")}</p>
                </div>
                <Button onClick={openCreate} className="gap-2 shrink-0">
                    <Plus className="h-4 w-4" /> Create Link
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {links.map((link) => (
                    <Card key={link.id} className="bg-card/50 flex flex-col relative overflow-hidden">
                        <CardContent className="p-5 flex flex-col h-full gap-4">
                            <div className="flex justify-between items-start gap-4">
                                <div className="space-y-1 overflow-hidden">
                                    <div className="flex items-center gap-2">
                                        <LinkIcon className="h-4 w-4 shrink-0 text-primary" />
                                        <h3 className="font-semibold text-lg truncate" title={link.slug}>
                                            {link.slug}
                                        </h3>
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate" title={link.destination}>
                                        → {link.destination}
                                    </p>
                                </div>
                                <Badge
                                    variant={link.isActive ? "default" : "secondary"}
                                    className="cursor-pointer shrink-0"
                                    onClick={() => toggleActive(link)}
                                >
                                    {link.isActive ? "Active" : "Inactive"}
                                </Badge>
                            </div>

                            {link.description && (
                                <p className="text-sm text-muted-foreground/80 line-clamp-2">
                                    {link.description}
                                </p>
                            )}

                            <div className="mt-auto pt-4 flex gap-2 justify-between items-center border-t border-white/5">
                                <Button variant="ghost" size="sm" className="gap-2" onClick={() => openAnalytics(link)}>
                                    <LineChart className="h-4 w-4 text-green-400" />
                                    <span>{link.visitsCount} visits</span>
                                </Button>

                                <div className="flex gap-1 shrink-0">
                                    <Button variant="ghost" size="icon" onClick={() => openEdit(link)}>
                                        <Edit className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-destructive hover:bg-destructive/10"
                                        onClick={() => handleDelete(link.id)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
                {links.length === 0 && (
                    <div className="col-span-full py-12 text-center text-muted-foreground border border-dashed rounded-xl border-white/10">
                        No custom links created yet
                    </div>
                )}
            </div>

            {/* Editor Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                {dialogOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-card p-6 shadow-xl animate-in fade-in zoom-in-95">
                            <DialogHeader className="mb-6">
                                <DialogTitle className="text-xl">{editingLink ? "Edit Link" : "Create Link"}</DialogTitle>
                            </DialogHeader>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">{t("slug")}</label>
                                    <Input
                                        placeholder="e.g. reddit, twitter, promo2024"
                                        value={form.slug}
                                        onChange={(e) => setForm({ ...form, slug: e.target.value })}
                                    />
                                    <p className="text-xs text-muted-foreground">Path: /l/<b>{form.slug || "..."}</b></p>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium">{t("destination")}</label>
                                    <Input
                                        placeholder="/models/foo or https://external.com"
                                        value={form.destination}
                                        onChange={(e) => setForm({ ...form, destination: e.target.value })}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Description (optional)</label>
                                    <Input
                                        placeholder="Campaign description..."
                                        value={form.description}
                                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                                    />
                                </div>

                                {error && <p className="text-sm text-destructive">{error}</p>}
                            </div>

                            <DialogFooter className="mt-8 flex gap-3">
                                <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving} className="flex-1 border border-white/20 hover:bg-white/10">
                                    Cancel
                                </Button>
                                <Button onClick={handleSave} disabled={saving} className="flex-1 bg-white text-black hover:bg-neutral-200">
                                    {saving ? "Saving..." : "Save"}
                                </Button>
                            </DialogFooter>
                        </div>
                    </div>
                )}
            </Dialog>

            {/* Analytics Dialog */}
            <Dialog open={analyticsOpen} onOpenChange={setAnalyticsOpen}>
                {analyticsOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                        <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-card p-6 shadow-xl animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
                            <DialogHeader className="mb-6">
                                <DialogTitle className="text-xl">Analytics: {selectedLink?.slug}</DialogTitle>
                                <p className="text-sm text-muted-foreground truncate">{selectedLink?.destination}</p>
                            </DialogHeader>

                            {loadingAnalytics ? (
                                <div className="py-12 text-center text-muted-foreground">Loading analytics...</div>
                            ) : (
                                <div className="space-y-8">
                                    {/* Daily Chart Mockup / Data List */}
                                    <div>
                                        <h3 className="text-sm font-medium mb-3">Visits over time (Last 30 days)</h3>
                                        {analyticsData?.daily && analyticsData.daily.length > 0 ? (
                                            <div className="h-40 flex items-end gap-1 w-full border-b border-white/10 pb-2">
                                                {analyticsData.daily.map((d, i) => {
                                                    const maxCount = Math.max(...analyticsData.daily.map(x => x.count), 1);
                                                    const heightPct = Math.max((d.count / maxCount) * 100, 2);
                                                    return (
                                                        <div key={i} className="flex-1 flex flex-col justify-end items-center group relative h-full">
                                                            <div
                                                                className="w-full bg-primary/40 hover:bg-primary transition-colors rounded-t-sm"
                                                                style={{ height: `${heightPct}%` }}
                                                            />
                                                            <div className="absolute bottom-full mb-2 hidden group-hover:block z-10 whitespace-nowrap bg-black text-xs px-2 py-1 rounded border border-white/10 shadow-lg">
                                                                {d.date}: {d.count} visits
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="text-sm text-muted-foreground py-6 text-center border rounded-lg border-white/5 bg-black/20">No visits recorded in the last 30 days.</div>
                                        )}
                                    </div>

                                    {/* Referrers */}
                                    <div>
                                        <h3 className="text-sm font-medium mb-3">Top Referrers</h3>
                                        {analyticsData?.referers && analyticsData.referers.length > 0 ? (
                                            <div className="space-y-2">
                                                {analyticsData.referers.map((r, i) => (
                                                    <div key={i} className="flex items-center justify-between text-sm p-3 rounded-lg bg-white/5 border border-white/5">
                                                        <span className="truncate pr-4 font-mono text-xs">{r.referer}</span>
                                                        <Badge variant="secondary" className="shrink-0">{r.count}</Badge>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-sm text-muted-foreground py-6 text-center border rounded-lg border-white/5 bg-black/20">No referrers recorded yet.</div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <DialogFooter className="mt-8 border-t border-white/10 pt-4">
                                <Button variant="ghost" onClick={() => setAnalyticsOpen(false)} className="w-full sm:w-auto ml-auto border border-white/20">
                                    Close
                                </Button>
                            </DialogFooter>
                        </div>
                    </div>
                )}
            </Dialog>
        </div>
    );
}
