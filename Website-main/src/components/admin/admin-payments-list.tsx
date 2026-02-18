"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { CheckCircle, XCircle, Eye, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatPrice } from "@/lib/utils";
import { logger } from "@/lib/logger";

interface PurchaseItem {
  id: string;
  userEmail: string;
  userName: string | null;
  packageName: string;
  credits: number;
  amount: number;
  paymentMethod: string;
  transactionCode: string;
  blikCode: string | null;
  cryptoCurrency: string | null;
  txId: string | null;
  status: string;
  paymentProofUrl: string | null;
  adminNotes: string | null;
  expirationTime: string;
  createdAt: string;
}

type SortKey = "user" | "package" | "amount" | "method" | "code" | "status" | "date";
type SortDir = "asc" | "desc";

export function AdminPaymentsList({ purchases }: { purchases: PurchaseItem[] }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [filter, setFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<PurchaseItem[]>(purchases);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseItem | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    setItems(purchases);
  }, [purchases]);

  useEffect(() => {
    let isActive = true;
    const refresh = async () => {
      try {
        const params = new URLSearchParams({
          sortBy: sortKey,
          sortDir: sortDir,
        });
        const res = await fetch(`/api/admin/credits/purchases?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!isActive) return;
        const next = data.purchases as PurchaseItem[];
        setItems(next);
        setSelectedIds((prev) => {
          const nextIds = new Set(next.map((p) => p.id));
          return new Set([...prev].filter((id) => nextIds.has(id)));
        });
      } catch {
        // Silent fail, will retry
      }
    };

    refresh();
    const interval = setInterval(refresh, 5000);
    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [sortKey, sortDir]);

  const filteredPurchases = items.filter((p) => {
    const matchesStatus = filter === "ALL" || p.status === filter;
    const matchesSearch =
      !search ||
      p.userEmail.toLowerCase().includes(search.toLowerCase()) ||
      p.transactionCode.toLowerCase().includes(search.toLowerCase()) ||
      (p.blikCode && p.blikCode.toLowerCase().includes(search.toLowerCase()));
    return matchesStatus && matchesSearch;
  });


  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  };

  const renderSortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDir === "asc" ? "▲" : "▼";
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "PENDING":
        return <Badge variant="warning">Pending</Badge>;
      case "APPROVED":
        return <Badge variant="success">Approved</Badge>;
      case "REJECTED":
        return <Badge variant="destructive">Rejected</Badge>;
      case "EXPIRED":
        return <Badge variant="secondary">Expired</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const handleAction = async (id: string, action: "approve" | "reject") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/credits/purchases/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });

      if (res.ok) {
        setSelectedPurchase(null);
        setNotes("");
        router.refresh();
      }
    } catch (error) {
      logger.error("Failed to update purchase status", error);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkAction = async (action: "approve" | "reject") => {
    setLoading(true);
    try {
      for (const id of selectedIds) {
        await fetch(`/api/admin/credits/purchases/${id}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: "" }),
        });
      }
      setSelectedIds(new Set());
      router.refresh();
    } catch (error) {
      logger.error("Failed to apply bulk action", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  return (
    <>
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by email or code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          {["ALL", "PENDING", "APPROVED", "REJECTED", "EXPIRED"].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                filter === s ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-secondary/80"
              }`}
            >
              {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex gap-2 mb-4 p-3 rounded-lg bg-secondary">
          <span className="text-sm self-center">{selectedIds.size} selected</span>
          <Button size="sm" variant="success" onClick={() => handleBulkAction("approve")} disabled={loading}>
            {t("bulkApprove")}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => handleBulkAction("reject")} disabled={loading}>
            {t("bulkReject")}
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-3 text-left w-8"></th>
              <th className="p-3 text-left">
                <button
                  type="button"
                  onClick={() => handleSort("user")}
                  className="inline-flex items-center gap-2 hover:text-foreground"
                >
                  User {renderSortIndicator("user")}
                </button>
              </th>
              <th className="p-3 text-left">
                <button
                  type="button"
                  onClick={() => handleSort("package")}
                  className="inline-flex items-center gap-2 hover:text-foreground"
                >
                  Package {renderSortIndicator("package")}
                </button>
              </th>
              <th className="p-3 text-left">
                <button
                  type="button"
                  onClick={() => handleSort("amount")}
                  className="inline-flex items-center gap-2 hover:text-foreground"
                >
                  Amount {renderSortIndicator("amount")}
                </button>
              </th>
              <th className="p-3 text-left">
                <button
                  type="button"
                  onClick={() => handleSort("method")}
                  className="inline-flex items-center gap-2 hover:text-foreground"
                >
                  Method {renderSortIndicator("method")}
                </button>
              </th>
              <th className="p-3 text-left">
                <button
                  type="button"
                  onClick={() => handleSort("code")}
                  className="inline-flex items-center gap-2 hover:text-foreground"
                >
                  Code {renderSortIndicator("code")}
                </button>
              </th>
              <th className="p-3 text-left">
                <button
                  type="button"
                  onClick={() => handleSort("status")}
                  className="inline-flex items-center gap-2 hover:text-foreground"
                >
                  Status {renderSortIndicator("status")}
                </button>
              </th>
              <th className="p-3 text-left">
                <button
                  type="button"
                  onClick={() => handleSort("date")}
                  className="inline-flex items-center gap-2 hover:text-foreground"
                >
                  Date {renderSortIndicator("date")}
                </button>
              </th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredPurchases.map((p) => (
              <motion.tr
                key={p.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="border-t border-border hover:bg-muted/50 transition-colors"
              >
                <td className="p-3">
                  {p.status === "PENDING" && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      className="rounded border-border cursor-pointer"
                    />
                  )}
                </td>
                <td className="p-3">
                  <p className="font-medium">{p.userName || "—"}</p>
                  <p className="text-xs text-muted-foreground">{p.userEmail}</p>
                </td>
                <td className="p-3">{p.packageName}</td>
                <td className="p-3">{formatPrice(p.amount)}</td>
                <td className="p-3">
                  <span className="text-xs">{p.paymentMethod}</span>
                  {p.cryptoCurrency && (
                    <span className="text-xs text-muted-foreground ml-1">({p.cryptoCurrency})</span>
                  )}
                </td>
                <td className="p-3 font-mono text-xs">
                  {p.paymentMethod === "BLIK" && p.blikCode ? p.blikCode : p.transactionCode}
                </td>
                <td className="p-3">{statusBadge(p.status)}</td>
                <td className="p-3 text-xs text-muted-foreground">
                  {new Date(p.createdAt).toLocaleDateString()}
                </td>
                <td className="p-3">
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSelectedPurchase(p);
                        setNotes(p.adminNotes || "");
                      }}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    {p.status === "PENDING" && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-success hover:text-success"
                          onClick={() => handleAction(p.id, "approve")}
                          disabled={loading}
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleAction(p.id, "reject")}
                          disabled={loading}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail Modal */}
      {selectedPurchase && (
        <Dialog open={!!selectedPurchase} onOpenChange={() => setSelectedPurchase(null)}>
          <DialogHeader>
            <DialogTitle>Credit Purchase Details</DialogTitle>
            <DialogDescription>
              Transaction: {selectedPurchase.transactionCode}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">User</p>
                <p className="font-medium">{selectedPurchase.userEmail}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Package</p>
                <p className="font-medium">{selectedPurchase.packageName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Amount</p>
                <p className="font-medium">{formatPrice(selectedPurchase.amount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Credits</p>
                <p className="font-medium">{selectedPurchase.credits}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Method</p>
                <p className="font-medium">{selectedPurchase.paymentMethod}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                {statusBadge(selectedPurchase.status)}
              </div>
              {selectedPurchase.blikCode && (
                <div>
                  <p className="text-muted-foreground">BLIK Code</p>
                  <p className="font-mono font-medium">{selectedPurchase.blikCode}</p>
                </div>
              )}
              {selectedPurchase.txId && (
                <div className="col-span-2">
                  <p className="text-muted-foreground">Transaction ID (TxID)</p>
                  <p className="font-mono text-xs break-all">{selectedPurchase.txId}</p>
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <p className="text-sm text-muted-foreground mb-1">Admin Notes</p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-border bg-muted p-3 text-sm resize-none h-20"
                placeholder={t("addNotes")}
              />
            </div>
          </div>

          {selectedPurchase.status === "PENDING" && (
            <DialogFooter>
              <Button
                variant="destructive"
                onClick={() => handleAction(selectedPurchase.id, "reject")}
                disabled={loading}
              >
                <XCircle className="h-4 w-4 mr-2" />
                {t("reject")}
              </Button>
              <Button
                variant="success"
                onClick={() => handleAction(selectedPurchase.id, "approve")}
                disabled={loading}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                {t("approve")}
              </Button>
            </DialogFooter>
          )}
        </Dialog>
      )}
    </>
  );
}
