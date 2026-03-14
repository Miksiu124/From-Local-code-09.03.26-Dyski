"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, Download, Search, Eye, EyeOff, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { logger } from "@/lib/logger";

interface Model {
  id: string;
  name: string;
  folderName: string;
  countryName: string | null;
  contentCount: number;
  isActive: boolean;
  isFeatured: boolean;
  lastSyncedAt: string | null;
}

type SortKey = "name" | "folderName" | "countryName" | "contentCount" | "isActive" | "isFeatured" | "lastSyncedAt";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 20;

export default function AdminModelsPage() {
  const t = useTranslations("admin");
  const [models, setModels] = useState<Model[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncResult, setSyncResult] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: PAGE_SIZE.toString(),
        sortBy: sortKey,
        sortDir: sortDir,
      });
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/models?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setModels(data.models || []);
        setTotal(data.total ?? 0);
        setTotalPages(data.totalPages ?? 1);
      }
    } catch (error) {
      logger.error("Failed to fetch models", error);
    } finally {
      setLoading(false);
    }
  }, [page, search, sortKey, sortDir]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const handleImport = async () => {
    const folderName = prompt("Nazwa folderu modelu w R2 (np. TEST):");
    if (!folderName?.trim()) return;

    setImporting(true);
    setSyncResult("");
    try {
      const res = await fetch("/api/admin/r2/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderName: folderName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(
          `Import complete: ${data.imported} items imported (${data.totalObjects} objects scanned)`
        );
        fetchModels();
      } else {
        const errorMessage = data.message || data.error || "Unknown error";
        setSyncResult(`Import failed: ${errorMessage}`);
      }
    } catch {
      setSyncResult("Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult("");
    try {
      const res = await fetch("/api/admin/r2/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(
          `Sync complete: ${data.syncedModels} models synced, ${data.newContentItems} new items (${data.totalObjects} objects scanned)`
        );
        fetchModels();
      } else {
        const errorMessage = data.message || data.error || "Unknown error";
        setSyncResult(`Sync failed: ${errorMessage}`);
      }
    } catch {
      setSyncResult("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const toggleVisibility = async (modelId: string, currentActive: boolean) => {
    if (togglingId) return;
    setTogglingId(modelId);
    try {
      const res = await fetch("/api/admin/models", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: modelId, isActive: !currentActive }),
      });
      if (res.ok) {
        setModels((prev) =>
          prev.map((m) => (m.id === modelId ? { ...m, isActive: !currentActive } : m))
        );
      }
    } finally {
      setTogglingId(null);
    }
  };

  const toggleFeatured = async (modelId: string, currentFeatured: boolean) => {
    if (togglingId) return;
    setTogglingId(modelId);
    try {
      const res = await fetch("/api/admin/models", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: modelId, isFeatured: !currentFeatured }),
      });
      if (res.ok) {
        setModels((prev) =>
          prev.map((m) => (m.id === modelId ? { ...m, isFeatured: !currentFeatured } : m))
        );
      }
    } finally {
      setTogglingId(null);
    }
  };

  const getSyncStatusColor = (dateStr: string | null) => {
    if (!dateStr) return "text-destructive";
    const date = new Date(dateStr);
    const now = new Date();
    const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffHours < 24) return "text-success";
    if (diffHours < 72) return "text-warning";
    return "text-destructive";
  };


  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  const renderSortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDir === "asc" ? "▲" : "▼";
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("models")}</h1>
        <div className="flex gap-2">
          <Button onClick={handleImport} disabled={importing} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            {importing ? t("importing") : t("importR2")}
          </Button>
          <Button onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? t("syncing") : t("syncR2")}
          </Button>
        </div>
      </div>

      {syncResult && (
        <div className="mb-4 p-3 rounded-lg bg-secondary text-sm">{syncResult}</div>
      )}

      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search models..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground">Loading...</div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-3 text-left">
                  <button
                    type="button"
                    onClick={() => handleSort("name")}
                    className="inline-flex items-center gap-2 hover:text-foreground"
                  >
                    Name {renderSortIndicator("name")}
                  </button>
                </th>
                <th className="p-3 text-left">
                  <button
                    type="button"
                    onClick={() => handleSort("folderName")}
                    className="inline-flex items-center gap-2 hover:text-foreground"
                  >
                    Folder {renderSortIndicator("folderName")}
                  </button>
                </th>
                <th className="p-3 text-left">
                  <button
                    type="button"
                    onClick={() => handleSort("countryName")}
                    className="inline-flex items-center gap-2 hover:text-foreground"
                  >
                    Country {renderSortIndicator("countryName")}
                  </button>
                </th>
                <th className="p-3 text-left">
                  <button
                    type="button"
                    onClick={() => handleSort("contentCount")}
                    className="inline-flex items-center gap-2 hover:text-foreground"
                  >
                    Items {renderSortIndicator("contentCount")}
                  </button>
                </th>
                <th className="p-3 text-left">
                  <button
                    type="button"
                    onClick={() => handleSort("isActive")}
                    className="inline-flex items-center gap-2 hover:text-foreground"
                  >
                    Status {renderSortIndicator("isActive")}
                  </button>
                </th>
                <th className="p-3 text-center">
                  <button
                    type="button"
                    onClick={() => handleSort("isFeatured")}
                    className="inline-flex items-center gap-2 hover:text-foreground"
                  >
                    Featured {renderSortIndicator("isFeatured")}
                  </button>
                </th>
                <th className="p-3 text-left">
                  <button
                    type="button"
                    onClick={() => handleSort("lastSyncedAt")}
                    className="inline-flex items-center gap-2 hover:text-foreground"
                  >
                    Last Synced {renderSortIndicator("lastSyncedAt")}
                  </button>
                </th>
                <th className="p-3 text-center w-20">Visibility</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr
                  key={m.id}
                  className={`border-t border-border hover:bg-muted/50 transition-colors ${!m.isActive ? "opacity-50" : ""}`}
                >
                  <td className={`p-3 font-medium ${!m.isActive ? "line-through" : ""}`}>{m.name}</td>
                  <td className="p-3 text-xs font-mono text-muted-foreground">{m.folderName}</td>
                  <td className="p-3">{m.countryName || "—"}</td>
                  <td className="p-3">{m.contentCount}</td>
                  <td className="p-3">
                    <Badge variant={m.isActive ? "success" : "secondary"}>
                      {m.isActive ? "Active" : "Hidden"}
                    </Badge>
                  </td>
                  <td className="p-3 text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => toggleFeatured(m.id, m.isFeatured)}
                      disabled={togglingId === m.id}
                      title={m.isFeatured ? "Remove from featured" : "Add to featured"}
                    >
                      <span className={`text-lg ${m.isFeatured ? "text-yellow-400" : "text-muted-foreground/30 hover:text-yellow-400/50"}`}>
                        ★
                      </span>
                    </Button>
                  </td>
                  <td className={`p-3 text-xs ${getSyncStatusColor(m.lastSyncedAt)}`}>
                    {m.lastSyncedAt
                      ? new Date(m.lastSyncedAt).toLocaleString()
                      : "Never"}
                  </td>
                  <td className="p-3 text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => toggleVisibility(m.id, m.isActive)}
                      disabled={togglingId === m.id}
                      title={m.isActive ? "Hide from users" : "Show to users"}
                    >
                      {m.isActive ? (
                        <Eye className="h-4 w-4" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-border px-4 py-3 bg-muted/30">
            <span className="text-sm text-muted-foreground">
              {total === 0
                ? "No models"
                : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
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
        </div>
      )}
    </div>
  );
}
