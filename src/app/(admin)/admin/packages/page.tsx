"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatPrice } from "@/lib/utils";
import { logger } from "@/lib/logger";

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price: number;
  tier: number;
  isActive: boolean;
}

export default function AdminPackagesPage() {
  const t = useTranslations("admin");
  const router = useRouter();
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState<CreditPackage | null>(null);
  const [form, setForm] = useState({ name: "", credits: 0, price: 0, tier: 0 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPackages();
  }, []);

  const fetchPackages = async () => {
    try {
      const res = await fetch("/api/admin/packages", { credentials: "include" });
      if (res.ok) {
        setPackages(await res.json());
      }
    } catch (error) {
      logger.error("Failed to fetch packages", error);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingPkg(null);
    setForm({ name: "", credits: 0, price: 0, tier: 0 });
    setDialogOpen(true);
  };

  const openEdit = (pkg: CreditPackage) => {
    setEditingPkg(pkg);
    setForm({ name: pkg.name, credits: pkg.credits, price: pkg.price, tier: pkg.tier });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const url = editingPkg
        ? `/api/admin/packages/${editingPkg.id}`
        : "/api/admin/packages";
      const method = editingPkg ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });

      if (res.ok) {
        setDialogOpen(false);
        fetchPackages();
      }
    } catch (error) {
      logger.error("Failed to save package", error);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (pkg: CreditPackage) => {
    try {
      await fetch(`/api/admin/packages/${pkg.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...pkg, isActive: !pkg.isActive }),
      });
      fetchPackages();
    } catch (error) {
      logger.error("Failed to toggle package status", error);
    }
  };

  if (loading) {
    return <div className="text-center py-20 text-muted-foreground">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("creditPackages")}</h1>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t("createPackage")}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {packages.map((pkg) => (
          <Card key={pkg.id} className={!pkg.isActive ? "opacity-50" : ""}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">{pkg.name}</h3>
                  <p className="text-sm text-muted-foreground">Tier {pkg.tier}</p>
                </div>
                <Badge variant={pkg.isActive ? "success" : "secondary"}>
                  {pkg.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div className="mb-4">
                <p className="text-3xl font-bold">{formatPrice(pkg.price)}</p>
                <p className="text-sm text-primary">{pkg.credits} credits</p>
                <p className="text-xs text-muted-foreground">
                  {formatPrice(pkg.price / pkg.credits)} per credit
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(pkg)}>
                  <Edit className="h-3 w-3 mr-1" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => toggleActive(pkg)}
                >
                  {pkg.isActive ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>
            {editingPkg ? t("editPackage") : t("createPackage")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 my-4">
          <div>
            <label className="text-sm font-medium">{t("packageName")}</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Starter Pack"
            />
          </div>
          <div>
            <label className="text-sm font-medium">{t("packageCredits")}</label>
            <Input
              type="number"
              value={form.credits}
              onChange={(e) => setForm({ ...form, credits: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">{t("packagePrice")}</label>
            <Input
              type="number"
              step="0.01"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">{t("packageTier")}</label>
            <Input
              type="number"
              value={form.tier}
              onChange={(e) => setForm({ ...form, tier: Number(e.target.value) })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
