"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Row = {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  title: string;
  details: string;
  contact: string;
  budgetCredits?: number | null;
  status: "OPEN" | "REVIEWING" | "APPROVED" | "REJECTED" | "FULFILLED";
  adminNotes?: string;
  createdAt: string;
  updatedAt: string;
};

const STATUSES = ["OPEN", "REVIEWING", "APPROVED", "REJECTED", "FULFILLED"] as const;

export default function AdminCustomOrdersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/custom-orders", { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as Row[];
        setRows(Array.isArray(data) ? data : []);
      } else {
        setRows([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateStatus = async (id: string, status: Row["status"]) => {
    setSavingId(id);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/admin/custom-orders/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatusMessage(data.message || data.error || "Failed to update");
        return;
      }
      await load();
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Custom orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review user custom requests and update their status.
        </p>
      </div>

      {statusMessage ? (
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm">{statusMessage}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-card/30">
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted-foreground">No custom order requests.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-sm">
              <thead className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 text-left font-medium">User</th>
                  <th className="px-3 py-3 text-left font-medium">Request</th>
                  <th className="px-3 py-3 text-left font-medium">Contact</th>
                  <th className="px-3 py-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-border/60 align-top">
                    <td className="px-3 py-3">
                      <p className="font-medium">{row.userName || "—"}</p>
                      <p className="text-xs text-muted-foreground">{row.userEmail}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium">{row.title}</p>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{row.details}</p>
                      {typeof row.budgetCredits === "number" ? (
                        <p className="mt-1 text-xs text-foreground/90">Budget: {row.budgetCredits} credits</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{row.contact || "—"}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        {STATUSES.map((status) => (
                          <Button
                            key={status}
                            size="sm"
                            variant={row.status === status ? "default" : "outline"}
                            disabled={savingId === row.id}
                            onClick={() => void updateStatus(row.id, status)}
                          >
                            {savingId === row.id && row.status === status ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              status
                            )}
                          </Button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
