"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Plus, Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { logger } from "@/lib/logger";

interface PromoCode {
  id: string;
  code: string;
  discountType: string;
  discountValue: number;
  minPurchaseCredits: number;
  minPurchaseAmount?: number | null;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  isActive: boolean;
  oncePerUser?: boolean;
  firstPurchaseOnly?: boolean;
  createdAt: string;
}

export default function AdminPromoCodesPage() {
  const t = useTranslations("admin");
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPromo, setEditingPromo] = useState<PromoCode | null>(null);
  const [form, setForm] = useState({
    code: "",
    discountType: "PERCENT" as "PERCENT" | "FIXED_CREDITS",
    discountValue: 10,
    minPurchaseCredits: 0,
    minPurchaseAmount: "" as string | number,
    maxUses: "" as string | number,
    expiresAt: "",
    oncePerUser: false,
    firstPurchaseOnly: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchPromos();
  }, []);

  const fetchPromos = async () => {
    try {
      const res = await fetch("/api/admin/promo-codes", { credentials: "include" });
      if (res.ok) {
        setPromos(await res.json());
      }
    } catch (err) {
      logger.error("Failed to fetch promo codes", err);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingPromo(null);
    setForm({
      code: "",
      discountType: "PERCENT",
      discountValue: 10,
      minPurchaseCredits: 0,
      minPurchaseAmount: "",
      maxUses: "",
      expiresAt: "",
      oncePerUser: false,
      firstPurchaseOnly: false,
    });
    setError("");
    setDialogOpen(true);
  };

  const openEdit = (promo: PromoCode) => {
    setEditingPromo(promo);
    setForm({
      code: promo.code,
      discountType: promo.discountType as "PERCENT" | "FIXED_CREDITS",
      discountValue: promo.discountValue,
      minPurchaseCredits: promo.minPurchaseCredits,
      minPurchaseAmount:
        promo.minPurchaseAmount != null && promo.minPurchaseAmount !== undefined
          ? promo.minPurchaseAmount
          : "",
      maxUses: promo.maxUses ?? "",
      expiresAt: promo.expiresAt ? promo.expiresAt.slice(0, 16) : "",
      oncePerUser: promo.oncePerUser ?? false,
      firstPurchaseOnly: promo.firstPurchaseOnly ?? false,
    });
    setError("");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setError("");
    setSaving(true);
    try {
      const minPurchaseAmount =
        editingPromo
          ? form.minPurchaseAmount === "" || form.minPurchaseAmount === undefined
            ? 0
            : Number(form.minPurchaseAmount)
          : form.minPurchaseAmount === "" || form.minPurchaseAmount === undefined
            ? undefined
            : Number(form.minPurchaseAmount);
      const basePayload = {
        discountType: form.discountType,
        discountValue: form.discountValue,
        minPurchaseCredits: form.minPurchaseCredits,
        ...(minPurchaseAmount !== undefined ? { minPurchaseAmount } : {}),
        maxUses: form.maxUses === "" ? null : Number(form.maxUses),
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        oncePerUser: form.oncePerUser,
        firstPurchaseOnly: form.firstPurchaseOnly,
      };
      const payload = editingPromo
        ? basePayload
        : { ...basePayload, code: form.code.trim().toUpperCase() };

      const url = editingPromo
        ? `/api/admin/promo-codes/${editingPromo.id}`
        : "/api/admin/promo-codes";
      const method = editingPromo ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDialogOpen(false);
        fetchPromos();
      } else {
        setError(data.message || data.error || "Failed to save");
      }
    } catch (err) {
      logger.error("Failed to save promo code", err);
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (promo: PromoCode) => {
    try {
      const res = await fetch(`/api/admin/promo-codes/${promo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive: !promo.isActive }),
      });
      if (res.ok) fetchPromos();
    } catch (err) {
      logger.error("Failed to toggle promo status", err);
    }
  };

  const handleDelete = async (promo: PromoCode) => {
    if (!confirm(t("promoDeleteConfirm"))) return;
    try {
      const res = await fetch(`/api/admin/promo-codes/${promo.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) fetchPromos();
    } catch (err) {
      logger.error("Failed to delete promo code", err);
    }
  };

  const formatDiscount = (p: PromoCode) => {
    if (p.discountType === "PERCENT") return `${p.discountValue}%`;
    return `+${p.discountValue} ${t("credits")}`;
  };

  const isExpired = (p: PromoCode) =>
    p.expiresAt && new Date(p.expiresAt) < new Date();

  const isExhausted = (p: PromoCode) =>
    p.maxUses != null && p.usedCount >= p.maxUses;

  if (loading) {
    return <div className="text-center py-20 text-muted-foreground">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("promoCodes")}</h1>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t("createPromoCode")}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {promos.map((promo) => {
          const expired = isExpired(promo);
          const exhausted = isExhausted(promo);
          const inactive = !promo.isActive || expired || exhausted;

          return (
            <Card key={promo.id} className={inactive ? "opacity-60" : ""}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold font-mono">{promo.code}</h3>
                    <p className="text-sm text-primary">{formatDiscount(promo)}</p>
                  </div>
                  <Badge variant={promo.isActive && !expired && !exhausted ? "success" : "secondary"}>
                    {!promo.isActive ? t("inactive") : expired ? t("expired") : exhausted ? t("exhausted") : t("active")}
                  </Badge>
                </div>
                <div className="mb-4 space-y-1 text-sm text-muted-foreground">
                  <p>{t("promoMinCredits")}: {promo.minPurchaseCredits}</p>
                  <p>
                    {t("promoMinPackagePrice")}:{" "}
                    {promo.minPurchaseAmount != null && promo.minPurchaseAmount > 0
                      ? promo.minPurchaseAmount
                      : "—"}
                  </p>
                  <p>{t("promoUsed")}: {promo.usedCount}{promo.maxUses != null ? ` / ${promo.maxUses}` : ""}</p>
                  {promo.expiresAt && (
                    <p>{t("promoExpires")}: {new Date(promo.expiresAt).toLocaleDateString()}</p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {promo.oncePerUser && <Badge variant="outline" className="text-xs">{t("promoOncePerUser")}</Badge>}
                    {promo.firstPurchaseOnly && <Badge variant="outline" className="text-xs">{t("promoFirstPurchaseOnly")}</Badge>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(promo)}>
                    <Edit className="h-3 w-3 mr-1" /> {t("edit")}
                  </Button>
                  {promo.usedCount === 0 && (
                    <Button size="sm" variant="ghost" onClick={() => toggleActive(promo)}>
                      {promo.isActive ? t("deactivate") : t("activate")}
                    </Button>
                  )}
                  {promo.usedCount === 0 && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(promo)}>
                      <Trash2 className="h-3 w-3 mr-1" /> {t("delete")}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {promos.length === 0 && (
        <p className="text-center py-12 text-muted-foreground">{t("noPromoCodes")}</p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>
            {editingPromo ? t("editPromoCode") : t("createPromoCode")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 my-4">
          <div>
            <label className="text-sm font-medium">{t("promoCode")}</label>
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="e.g. WELCOME20"
              disabled={!!editingPromo}
            />
          </div>
          <div>
            <label className="text-sm font-medium">{t("promoDiscountType")}</label>
            <select
              className="flex h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              value={form.discountType}
              onChange={(e) => setForm({ ...form, discountType: e.target.value as "PERCENT" | "FIXED_CREDITS" })}
            >
              <option value="PERCENT">{t("promoPercent")}</option>
              <option value="FIXED_CREDITS">{t("promoFixedCredits")}</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">
              {form.discountType === "PERCENT" ? t("promoPercentValue") : t("promoCreditsValue")}
            </label>
            <Input
              type="number"
              min={form.discountType === "PERCENT" ? 1 : 1}
              max={form.discountType === "PERCENT" ? 100 : undefined}
              value={form.discountValue}
              onChange={(e) => setForm({ ...form, discountValue: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">{t("promoMinCredits")}</label>
            <Input
              type="number"
              min={0}
              value={form.minPurchaseCredits}
              onChange={(e) => setForm({ ...form, minPurchaseCredits: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">{t("promoMinPackagePrice")}</label>
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="0"
              value={form.minPurchaseAmount}
              onChange={(e) =>
                setForm({ ...form, minPurchaseAmount: e.target.value === "" ? "" : e.target.value })
              }
            />
          </div>
          <div>
            <label className="text-sm font-medium">{t("promoMaxUses")}</label>
            <Input
              type="number"
              min={0}
              placeholder={t("promoUnlimited")}
              value={form.maxUses}
              onChange={(e) => setForm({ ...form, maxUses: e.target.value === "" ? "" : Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">{t("promoExpires")}</label>
            <Input
              type="datetime-local"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.oncePerUser}
                onChange={(e) => setForm({ ...form, oncePerUser: e.target.checked })}
                className="rounded border-white/20"
              />
              <span className="text-sm font-medium">{t("promoOncePerUser")}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.firstPurchaseOnly}
                onChange={(e) => setForm({ ...form, firstPurchaseOnly: e.target.checked })}
                className="rounded border-white/20"
              />
              <span className="text-sm font-medium">{t("promoFirstPurchaseOnly")}</span>
            </label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("cancel")}</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "..." : t("save")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
