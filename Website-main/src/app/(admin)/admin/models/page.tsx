"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, Download, Search, Eye, EyeOff } from "lucide-react";
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
  lastSyncedAt: string | null;
}

type SortKey = "name" | "folderName" | "countryName" | "contentCount" | "isActive" | "lastSyncedAt";
type SortDir = "asc" | "desc";

export default function AdminModelsPage() {
  const t = useTranslations("admin");
  const [models, setModels] = useState<Model[]>([]);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncResult, setSyncResult] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    fetchModels();
  }, [sortKey, sortDir]);

  const fetchModels = async () => {
    try {
      const params = new URLSearchParams({
        sortBy: sortKey,
        sortDir: sortDir,
      });
      const res = await fetch(`/api/admin/models?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setModels(data);
      }
    } catch (error) {
      logger.error("Failed to fetch models", error);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setSyncResult("");
    try {
      const res = await fetch("/api/admin/r2/import", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(
          `Import complete: ${data.modelsImported} new models, ${data.contentItemsImported} new items (${data.totalModels} total folders scanned)`
        );
        fetchModels();
      } else {
        const errorMessage = data.error?.message || data.error || "Unknown error";
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
        const parts = [
          `${data.newModels} new models`,
          `${data.newContentItems} new items`,
          `${data.updatedContentItems || 0} updated`,
        ];
        if (data.deactivatedContentItems > 0) parts.push(`${data.deactivatedContentItems} items deactivated`);
        if (data.deactivatedModels > 0) parts.push(`${data.deactivatedModels} models deactivated`);
        setSyncResult(`Sync complete: ${parts.join(", ")}`);
        fetchModels();
      } else {
        const errorMessage = data.error?.message || data.error || "Unknown error";
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

  const filteredModels = models.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase())
  );

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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground">Loading...</div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
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
              {filteredModels.map((m) => (
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
                  <td className="p-3 text-xs text-muted-foreground">
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
        </div>
      )}
    </div>
  );
}
