"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Users,
  Coins,
  ShieldCheck,
  X,
  ChevronLeft,
  ChevronRight,
  Eye,
  Plus,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatCredits } from "@/lib/utils";

interface UserItem {
  id: string;
  email: string;
  name: string | null;
  role: string;
  creditBalance: number;
  isBanned: boolean;
  emailVerified?: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  _count: {
    purchases: number;
    creditPurchases: number;
    userAccess: number;
  };
}

interface ModelOption {
  id: string;
  name: string;
  folderName: string;
}

interface UserDetail {
  id: string;
  email: string;
  name: string | null;
  role: string;
  creditBalance: number;
  isBanned: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  purchases: {
    id: string;
    purchaseType: string;
    accessDuration: string | null;
    creditsSpent: number;
    createdAt: string;
    model: { name: string } | null;
  }[];
  creditPurchases: {
    id: string;
    credits: number;
    amount: number;
    paymentMethod: string;
    status: string;
    createdAt: string;
    creditPackage: { name: string };
  }[];
  userAccess: {
    id: string;
    modelId: string | null;
    expiresAt: string | null;
    createdAt: string;
    model: { name: string } | null;
  }[];
}

type SortKey = "user" | "credits" | "purchases" | "access" | "joined";
type SortDir = "asc" | "desc";

export default function AdminUsersPage() {
  const t = useTranslations("admin");
  const [users, setUsers] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantModelId, setGrantModelId] = useState<string>("");
  const [grantDays, setGrantDays] = useState<string>("30");
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [creditsAmount, setCreditsAmount] = useState<number>(0);
  const [creditsReason, setCreditsReason] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("user");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "20",
        sortBy: sortKey,
        sortDir: sortDir,
      });
      if (search) params.set("search", search);
      if (verifiedOnly) params.set("verifiedOnly", "true");

      const res = await fetch(`/api/admin/users?${params}`);
      const data = await res.json();

      setUsers(data.users || []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
    } catch (error) {
      console.error("Failed to fetch users:", error);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, sortKey, sortDir, verifiedOnly]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetch("/api/admin/models")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data.data || data.models || [];
        setModels(list);
      })
      .catch(() => {});
  }, []);

  const handleViewUser = async (userId: string) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`);
      const data = await res.json();
      setSelectedUser(data);
      setDetailOpen(true);
    } catch {
      // Error handled silently
    }
  };

  const handleGrantAccess = async () => {
    if (!selectedUser) return;

    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: grantModelId || null,
          durationDays: grantDays ? parseInt(grantDays) : undefined,
        }),
      });

      if (res.ok) {
        setGrantOpen(false);
        setGrantModelId("");
        setGrantDays("30");
        handleViewUser(selectedUser.id);
      }
    } catch {
      // Error handled silently
    }
  };

  const handleRevokeAccess = async (accessId: string) => {
    if (!selectedUser) return;

    try {
      const res = await fetch(
        `/api/admin/users/${selectedUser.id}/access?accessId=${accessId}`,
        { method: "DELETE" }
      );

      if (res.ok) {
        handleViewUser(selectedUser.id); // Refresh
      }
    } catch {
      // Error handled silently
    }
  };

  const handleUpdateCredits = async () => {
    if (!selectedUser || creditsAmount === 0) return;
    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}/credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: creditsAmount, reason: creditsReason }),
      });
      if (res.ok) {
        setCreditsOpen(false);
        setCreditsAmount(0);
        setCreditsReason("");
        handleViewUser(selectedUser.id);
      }
    } catch (e) { console.error(e); }
  };

  const handleToggleBan = async () => {
    if (!selectedUser) return;
    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isBanned: !selectedUser.isBanned }),
      });
      if (res.ok) {
        handleViewUser(selectedUser.id);
      }
    } catch (e) { console.error(e); }
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      setPage(1);
      return;
    }
    setSortKey(key);
    setSortDir("asc");
    setPage(1);
  };

  const renderSortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDir === "asc" ? "▲" : "▼";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("allUsers")}</h1>
        <Badge variant="secondary">{total} users</Badge>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchByEmail")}
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(e) => { setVerifiedOnly(e.target.checked); setPage(1); }}
            className="rounded border-border"
          />
          <span className="text-sm">{t("verifiedOnly")}</span>
        </label>
      </div>

      {/* Users Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-4 font-medium text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => handleSort("user")}
                      className="inline-flex items-center gap-2 hover:text-foreground"
                    >
                      User {renderSortIndicator("user")}
                    </button>
                  </th>
                  <th className="text-left p-4 font-medium text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => handleSort("credits")}
                      className="inline-flex items-center gap-2 hover:text-foreground"
                    >
                      Credits {renderSortIndicator("credits")}
                    </button>
                  </th>
                  <th className="text-left p-4 font-medium text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => handleSort("purchases")}
                      className="inline-flex items-center gap-2 hover:text-foreground"
                    >
                      Purchases {renderSortIndicator("purchases")}
                    </button>
                  </th>
                  <th className="text-left p-4 font-medium text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => handleSort("access")}
                      className="inline-flex items-center gap-2 hover:text-foreground"
                    >
                      Access {renderSortIndicator("access")}
                    </button>
                  </th>
                  <th className="text-left p-4 font-medium text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => handleSort("joined")}
                      className="inline-flex items-center gap-2 hover:text-foreground"
                    >
                      Joined {renderSortIndicator("joined")}
                    </button>
                  </th>
                  <th className="text-right p-4 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      Loading...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      No users found
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.id} className="border-b border-border hover:bg-secondary/50 transition-colors">
                      <td className="p-4">
                        <div>
                          <p className="font-medium">{user.name || "No name"}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                            {user.email}
                            {user.emailVerified ? (
                              <Badge variant="secondary" className="text-[10px] px-1 py-0">✓</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 text-amber-500 border-amber-500/50">nie zweryf.</Badge>
                            )}
                          </p>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1">
                          <Coins className="h-3.5 w-3.5 text-primary" />
                          <span>{formatCredits(user.creditBalance)}</span>
                        </div>
                      </td>
                      <td className="p-4">{user._count.purchases}</td>
                      <td className="p-4">{user._count.userAccess}</td>
                      <td className="p-4 text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewUser(user.id)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-border px-4 py-3 bg-muted/30">
            <span className="text-sm text-muted-foreground">
              {total === 0
                ? "No users"
                : `Showing ${(page - 1) * 20 + 1}–${Math.min(page * 20, total)} of ${total}`}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm tabular-nums min-w-[6rem] text-center">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* User Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        {selectedUser && (
          <>
            <DialogHeader>
              <DialogTitle>{t("userDetails")}</DialogTitle>
            </DialogHeader>

            <div className="space-y-6 max-h-[60vh] overflow-y-auto">
              {/* User Info */}
              <div className="flex items-center gap-4 p-4 rounded-lg bg-secondary">
                <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">{selectedUser.name || "No name"}</p>
                      <p className="text-sm text-muted-foreground">{selectedUser.email}</p>
                    </div>
                    <Badge variant={selectedUser.isBanned ? "destructive" : "success"}>
                      {selectedUser.isBanned ? "Banned" : "Active"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 mt-2">
                    <div className="flex items-center gap-1">
                      <Coins className="h-3.5 w-3.5 text-primary" />
                      <span className="text-sm">{formatCredits(selectedUser.creditBalance)} credits</span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCreditsOpen(true)}>
                        Adjust Credits
                      </Button>
                      <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={handleToggleBan}>
                        {selectedUser.isBanned ? "Unban User" : "Ban User"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Active Access */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm">{t("accessHistory")}</h3>
                  <Button size="sm" variant="outline" onClick={() => setGrantOpen(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    {t("grantAccess")}
                  </Button>
                </div>
                {selectedUser.userAccess.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No access records</p>
                ) : (
                  <div className="space-y-2">
                    {selectedUser.userAccess.map((access) => {
                      const isExpired = access.expiresAt && new Date(access.expiresAt) < new Date();
                      const isBundle = !access.modelId;

                      return (
                        <div
                          key={access.id}
                          className={`flex items-center justify-between p-3 rounded-lg border ${isExpired ? "border-border opacity-50" : "border-primary/20 bg-primary/5"
                            }`}
                        >
                          <div>
                            <p className="text-sm font-medium">
                              {isBundle ? "Bundle (All Models)" : access.model?.name || "Unknown"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {access.expiresAt
                                ? `Expires: ${new Date(access.expiresAt).toLocaleDateString()}`
                                : "No expiration"}
                              {isExpired && " (Expired)"}
                            </p>
                          </div>
                          {!isExpired && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => handleRevokeAccess(access.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent Purchases */}
              <div>
                <h3 className="font-semibold text-sm mb-2">Recent Purchases</h3>
                {!selectedUser.purchases || selectedUser.purchases.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No purchases</p>
                ) : (
                  <div className="space-y-2">
                    {selectedUser.purchases.slice(0, 5).map((purchase) => (
                      <div key={purchase.id} className="flex items-center justify-between p-2 rounded-lg bg-secondary/50 text-sm">
                        <span>
                          {purchase.purchaseType === "BUNDLE"
                            ? "Bundle"
                            : purchase.model?.name || "Model"}
                        </span>
                        <span className="text-muted-foreground">
                          {purchase.creditsSpent} credits
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Credit Purchases */}
              <div>
                <h3 className="font-semibold text-sm mb-2">Credit Purchases</h3>
                {!selectedUser.creditPurchases || selectedUser.creditPurchases.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No credit purchases</p>
                ) : (
                  <div className="space-y-2">
                    {selectedUser.creditPurchases.slice(0, 5).map((cp) => (
                      <div key={cp.id} className="flex items-center justify-between p-2 rounded-lg bg-secondary/50 text-sm">
                        <div>
                          <span>{cp.creditPackage?.name || "Package"}</span>
                          <span className="text-muted-foreground ml-2">({cp.paymentMethod})</span>
                        </div>
                        <Badge variant={cp.status === "APPROVED" ? "success" : cp.status === "PENDING" ? "default" : "destructive"}>
                          {cp.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </Dialog>

      {/* Credits Dialog */}
      <Dialog open={creditsOpen} onOpenChange={setCreditsOpen}>
        <DialogHeader><DialogTitle>Adjust Credits</DialogTitle></DialogHeader>
        <div className="space-y-4 my-4">
          <div>
            <label className="text-sm font-medium">Amount (positive to add, negative to remove)</label>
            <Input type="number" value={creditsAmount} onChange={(e) => setCreditsAmount(Number(e.target.value))} />
          </div>
          <div>
            <label className="text-sm font-medium">Reason</label>
            <Input value={creditsReason} onChange={(e) => setCreditsReason(e.target.value)} placeholder="e.g. Bonus via Admin" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCreditsOpen(false)}>Cancel</Button>
          <Button onClick={handleUpdateCredits}>Save</Button>
        </DialogFooter>
      </Dialog>

      {/* Grant Access Dialog */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogHeader>
          <DialogTitle>{t("grantAccess")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Model (empty = all models)</label>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={grantModelId}
              onChange={(e) => setGrantModelId(e.target.value)}
            >
              <option value="">All models (bundle)</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Duration (days)</label>
            <Input
              placeholder="30"
              type="number"
              min="1"
              value={grantDays}
              onChange={(e) => setGrantDays(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setGrantOpen(false)}>Cancel</Button>
          <Button onClick={handleGrantAccess}>{t("grantAccess")}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
