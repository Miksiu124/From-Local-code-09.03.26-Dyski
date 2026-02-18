"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { logger } from "@/lib/logger";

interface SettingItem {
  key: string;
  value: unknown;
  description: string | null;
}

export default function AdminSettingsPage() {
  const t = useTranslations("admin");
  const [settings, setSettings] = useState<SettingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/admin/settings");
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (error) {
      logger.error("Failed to fetch settings", error);
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = (key: string, value: unknown) => {
    setSettings((prev) =>
      prev.map((s) => (s.key === key ? { ...s, value } : s))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      if (res.ok) {
        setMessage("Settings saved successfully");
      } else {
        setMessage("Failed to save settings");
      }
    } catch {
      setMessage("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const renderSettingInput = (setting: SettingItem) => {
    if (setting.key === "crypto_wallets" && typeof setting.value === "object") {
      const wallets = setting.value as Record<string, string>;
      return (
        <div className="space-y-2">
          {Object.entries(wallets).map(([currency, address]) => (
            <div key={currency} className="flex items-center gap-2">
              <span className="text-sm font-mono w-12">{currency}</span>
              <Input
                value={address}
                onChange={(e) => {
                  const newWallets = { ...wallets, [currency]: e.target.value };
                  updateSetting(setting.key, newWallets);
                }}
                placeholder={`${currency} wallet address`}
                className="flex-1"
              />
            </div>
          ))}
        </div>
      );
    }

    if (typeof setting.value === "number") {
      return (
        <Input
          type="number"
          value={setting.value}
          onChange={(e) => updateSetting(setting.key, Number(e.target.value))}
        />
      );
    }

    return (
      <Input
        value={String(setting.value)}
        onChange={(e) => updateSetting(setting.key, e.target.value)}
      />
    );
  };

  if (loading) {
    return <div className="text-center py-20 text-muted-foreground">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("settings")}</h1>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Saving..." : "Save All"}
        </Button>
      </div>

      {message && (
        <div className="mb-4 p-3 rounded-lg bg-secondary text-sm">{message}</div>
      )}

      <div className="space-y-4">
        {settings.map((setting) => (
          <Card key={setting.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono">{setting.key}</CardTitle>
              {setting.description && (
                <p className="text-xs text-muted-foreground">{setting.description}</p>
              )}
            </CardHeader>
            <CardContent>{renderSettingInput(setting)}</CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
