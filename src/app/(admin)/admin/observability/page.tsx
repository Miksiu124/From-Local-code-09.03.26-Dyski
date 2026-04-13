"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Activity, Cpu, Database, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type ClientErrorGroup = {
  fingerprint: string;
  errorKind: string;
  count: number;
  firstAt: string;
  lastAt: string;
  sampleMessage: string;
  samplePagePath: string;
};

type ClientErrorRow = {
  id: string;
  createdAt: string;
  message: string;
  stack: string;
  pagePath: string;
  component: string;
  clientIp: string;
  userAgent?: string;
  fingerprint: string;
  errorKind: string;
  browserFamily: string;
  release?: string;
  extra?: Record<string, unknown>;
};

type RuntimePayload = {
  allocBytes: number;
  sysBytes: number;
  heapObjects: number;
  numGC: number;
  pauseTotalNs: number;
  goroutines: number;
  goVersion: string;
  collectedAtRFC: string;
};

type DbBackupPayload = {
  configured: boolean;
  available?: boolean;
  path?: string;
  lastModifiedRFC?: string;
  sizeBytes?: number;
  error?: string;
};

function primaryStackFrame(stack: string): string {
  const lines = stack
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const meaningful = lines.find(
    (l) =>
      l.includes("/") ||
      l.includes(".js") ||
      l.includes(".tsx") ||
      l.includes(".ts") ||
      l.startsWith("at "),
  );
  return meaningful ?? lines[0] ?? "";
}

function truncateUa(ua: string, max = 96): string {
  const t = ua.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export default function AdminObservabilityPage() {
  const t = useTranslations("admin");
  const [errors, setErrors] = useState<ClientErrorRow[]>([]);
  const [groups, setGroups] = useState<ClientErrorGroup[]>([]);
  const [runtime, setRuntime] = useState<RuntimePayload | null>(null);
  const [dbBackup, setDbBackup] = useState<DbBackupPayload | null>(null);
  const [dbBackupFetchFailed, setDbBackupFetchFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const kindLabel = useMemo(
    () => (kind: string) => {
      const map: Record<string, string> = {
        other: t("observabilityKinds.other"),
        react_boundary: t("observabilityKinds.react_boundary"),
        unhandled_rejection: t("observabilityKinds.unhandled_rejection"),
        chunk_load: t("observabilityKinds.chunk_load"),
        script_error: t("observabilityKinds.script_error"),
        network: t("observabilityKinds.network"),
        unknown: t("observabilityKinds.unknown"),
      };
      return map[kind] ?? kind.replace(/_/g, " ");
    },
    [t],
  );

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [eRes, rRes, bRes] = await Promise.all([
        fetch("/api/admin/observability/client-errors"),
        fetch("/api/admin/observability/runtime"),
        fetch("/api/admin/observability/db-backup"),
      ]);
      if (!eRes.ok || !rRes.ok) {
        setErr(t("observabilityLoadFailed"));
        return;
      }
      if (bRes.ok) {
        setDbBackup((await bRes.json()) as DbBackupPayload);
        setDbBackupFetchFailed(false);
      } else {
        setDbBackup(null);
        setDbBackupFetchFailed(true);
      }
      const eData = await eRes.json();
      const rData = await rRes.json();
      const raw = Array.isArray(eData.errors) ? eData.errors : [];
      const normalized: ClientErrorRow[] = raw.map((row: ClientErrorRow & { extra?: unknown }) => ({
        ...row,
        extra:
          row.extra && typeof row.extra === "object" && row.extra !== null
            ? (row.extra as Record<string, unknown>)
            : undefined,
      }));
      setErrors(normalized);
      setGroups(Array.isArray(eData.groups) ? eData.groups : []);
      setRuntime(rData);
    } catch {
      setErr(t("observabilityLoadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const clearLogs = async () => {
    if (!window.confirm(t("observabilityClearLogsConfirm"))) return;
    setClearing(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/observability/client-errors", { method: "DELETE" });
      if (!res.ok) {
        setErr(t("observabilityClearLogsFailed"));
        return;
      }
      await load();
    } catch {
      setErr(t("observabilityClearLogsFailed"));
    } finally {
      setClearing(false);
    }
  };

  const mb = (n: number) => (n / (1024 * 1024)).toFixed(2);

  const formatBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-7 w-7 text-primary" />
            {t("observability")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("observabilityClientErrors")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || clearing} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("retryAnalytics")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void clearLogs()}
            disabled={loading || clearing}
            className="gap-2"
          >
            {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {t("observabilityClearLogs")}
          </Button>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {err}
        </div>
      )}

      <p className="text-xs text-muted-foreground leading-relaxed">{t("observabilityDwhHint")}</p>

      <section className="rounded-2xl border border-border bg-card/50 p-5">
        <h2 className="text-sm font-semibold flex items-center gap-2 mb-4">
          <Cpu className="h-4 w-4 text-primary" />
          {t("observabilityRuntime")}
        </h2>
        {loading && !runtime ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : runtime ? (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">{t("observabilityAllocMB")}</dt>
              <dd className="font-mono">{mb(runtime.allocBytes)} MB</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Sys</dt>
              <dd className="font-mono">{mb(runtime.sysBytes)} MB</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("observabilityGoroutines")}</dt>
              <dd className="font-mono">{runtime.goroutines}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("observabilityNumGC")}</dt>
              <dd className="font-mono">{runtime.numGC}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Go</dt>
              <dd className="font-mono text-xs">{runtime.goVersion}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border bg-card/50 p-5">
        <h2 className="text-sm font-semibold flex items-center gap-2 mb-2">
          <Database className="h-4 w-4 text-primary" />
          {t("observabilityDbBackup")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4 leading-relaxed">{t("observabilityDbBackupHint")}</p>
        {loading && !dbBackup && !dbBackupFetchFailed ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : dbBackupFetchFailed ? (
          <p className="text-sm text-destructive/90">{t("observabilityDbBackupLoadFailed")}</p>
        ) : dbBackup && !dbBackup.configured ? (
          <p className="text-sm text-muted-foreground">{t("observabilityDbBackupNotConfigured")}</p>
        ) : dbBackup && dbBackup.configured && !dbBackup.available ? (
          <p className="text-sm text-muted-foreground">{t("observabilityDbBackupNone")}</p>
        ) : dbBackup && dbBackup.configured && dbBackup.available && dbBackup.lastModifiedRFC ? (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">{t("observabilityDbBackupLast")}</dt>
              <dd className="font-mono">{new Date(dbBackup.lastModifiedRFC).toLocaleString()}</dd>
            </div>
            {typeof dbBackup.sizeBytes === "number" ? (
              <div>
                <dt className="text-muted-foreground">{t("observabilityDbBackupSize")}</dt>
                <dd className="font-mono">{formatBytes(dbBackup.sizeBytes)}</dd>
              </div>
            ) : null}
            {dbBackup.path ? (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">{t("observabilityPath")}</dt>
                <dd className="font-mono text-xs break-all">{dbBackup.path}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </section>

      {groups.length > 0 && (
        <section className="rounded-2xl border border-border bg-card/50 p-5">
          <h2 className="text-sm font-semibold mb-3">{t("observabilityGroupedTitle")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-border/80 text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{t("observabilityOccurrences")}</th>
                  <th className="py-2 pr-3 font-medium">{t("observabilityKind")}</th>
                  <th className="py-2 pr-3 font-medium">{t("observabilityMessage")}</th>
                  <th className="py-2 pr-3 font-medium">{t("observabilityPath")}</th>
                  <th className="py-2 pr-3 font-medium">{t("observabilityLastSeen")}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={`${g.fingerprint}-${g.errorKind}`} className="border-b border-border/40 align-top">
                    <td className="py-2 pr-3 font-mono tabular-nums">{g.count}</td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                        {kindLabel(g.errorKind)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 max-w-[220px] break-words">{g.sampleMessage}</td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground">{g.samplePagePath || "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                      {new Date(g.lastAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card/50 p-5">
        <h2 className="text-sm font-semibold mb-4">{t("observabilityClientErrors")}</h2>
        {loading && errors.length === 0 ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : errors.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("observabilityNoErrors")}</p>
        ) : (
          <ul className="space-y-4 max-h-[560px] overflow-y-auto pr-1">
            {errors.map((row) => {
              const primary = primaryStackFrame(row.stack);
              return (
                <li key={row.id} className="rounded-xl border border-border/80 bg-background/40 p-4 text-sm space-y-2">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="inline-flex rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                      {kindLabel(row.errorKind)}
                    </span>
                    {row.browserFamily && (
                      <span className="inline-flex rounded-md border border-white/[0.12] bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {row.browserFamily}
                      </span>
                    )}
                    {row.release ? (
                      <span className="text-[10px] font-mono text-muted-foreground">{row.release}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {t("observabilityTime")}: {new Date(row.createdAt).toLocaleString()}
                    </span>
                    {row.pagePath && (
                      <span>
                        {t("observabilityPath")}: {row.pagePath}
                      </span>
                    )}
                    {row.clientIp && (
                      <span>
                        {t("observabilityIP")}: {row.clientIp}
                      </span>
                    )}
                  </div>
                  {row.userAgent ? (
                    <p className="text-[11px] text-muted-foreground break-all" title={row.userAgent}>
                      <span className="font-medium text-foreground/80">{t("observabilityUserAgent")}: </span>
                      {truncateUa(row.userAgent)}
                    </p>
                  ) : null}
                  {row.fingerprint ? (
                    <p className="text-[10px] font-mono text-muted-foreground/90 break-all">
                      {t("observabilityFingerprint")}: {row.fingerprint}
                    </p>
                  ) : null}
                  <p className="font-medium text-foreground break-words">{row.message}</p>
                  {primary ? (
                    <p className="text-[11px] font-mono text-primary/90 break-all">
                      {t("observabilityPrimaryFrame")}: {primary}
                    </p>
                  ) : null}
                  {row.stack && (
                    <pre className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words max-h-40 overflow-y-auto bg-black/20 rounded-lg p-2 border border-white/[0.06]">
                      {row.stack}
                    </pre>
                  )}
                  {row.extra && Object.keys(row.extra).length > 0 ? (
                    <pre className="text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words max-h-24 overflow-y-auto bg-black/10 rounded-lg p-2 border border-white/[0.04]">
                      {JSON.stringify(row.extra, null, 2)}
                    </pre>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
