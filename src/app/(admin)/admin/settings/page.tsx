"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Save, Webhook, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { logger } from "@/lib/logger";

interface SettingItem {
  key: string;
  value: unknown;
  description: string | null;
}

const BOOLEAN_KEYS = ["blik_enabled"];
const FEATURED_KEYS = ["blik_enabled", "discord_webhook_url", "paypal_address", "revolut_address"];
const HIDDEN_KEYS = ["blik_enabled"];

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
      const res = await fetch("/api/admin/settings", { credentials: "include" });
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
        credentials: "include",
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

  const isBooleanSetting = (setting: SettingItem) => {
    if (BOOLEAN_KEYS.includes(setting.key)) return true;
    const v = setting.value;
    return v === true || v === false || v === "true" || v === "false";
  };

  const getBooleanValue = (setting: SettingItem): boolean => {
    const v = setting.value;
    return v === true || v === "true";
  };

  const renderSettingInput = (setting: SettingItem) => {
    if (isBooleanSetting(setting)) {
      const enabled = getBooleanValue(setting);
      return (
        <button
          type="button"
          onClick={() => updateSetting(setting.key, !enabled)}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors cursor-pointer ${
            enabled ? "bg-green-500" : "bg-red-500/70"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      );
    }

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

  const discordSetting = settings.find((s) => s.key === "discord_webhook_url");
  const paypalSetting = settings.find((s) => s.key === "paypal_address");
  const revolutSetting = settings.find((s) => s.key === "revolut_address");
  const otherSettings = settings.filter((s) => !FEATURED_KEYS.includes(s.key) && !HIDDEN_KEYS.includes(s.key));

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

      {/* Discord Webhook Card */}
      {discordSetting && (
        <Card className="mb-6 border-2 border-indigo-500/20">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10">
                <Webhook className="h-6 w-6 text-indigo-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Discord Webhook</h3>
                <p className="text-sm text-muted-foreground">
                  Receive payment notifications on your Discord server.
                </p>
              </div>
            </div>
            <Input
              value={String(discordSetting.value || "")}
              onChange={(e) => updateSetting("discord_webhook_url", e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              className="font-mono text-sm"
            />
          </CardContent>
        </Card>
      )}

      {/* Payment Addresses */}
      {(paypalSetting || revolutSetting) && (
        <Card className="mb-6 border-2 border-green-500/20">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/10">
                <CreditCard className="h-6 w-6 text-green-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Payment Addresses</h3>
                <p className="text-sm text-muted-foreground">
                  PayPal and Revolut addresses shown to users during checkout.
                </p>
              </div>
            </div>
            <div className="space-y-4">
              {paypalSetting && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    PayPal Address
                  </label>
                  <Input
                    value={String(paypalSetting.value || "")}
                    onChange={(e) => updateSetting("paypal_address", e.target.value)}
                    placeholder="your-paypal@email.com"
                    className="font-mono text-sm"
                  />
                </div>
              )}
              {revolutSetting && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Revolut Tag
                  </label>
                  <Input
                    value={String(revolutSetting.value || "")}
                    onChange={(e) => updateSetting("revolut_address", e.target.value)}
                    placeholder="@your-revolut-tag"
                    className="font-mono text-sm"
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Other Settings */}
      <div className="space-y-4">
        {!settings || settings.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground border rounded-lg">
            No settings found or failed to load.
          </div>
        ) : (
          otherSettings.map((setting) => (
            <Card key={setting.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono">{setting.key}</CardTitle>
                {setting.description && (
                  <p className="text-xs text-muted-foreground">{setting.description}</p>
                )}
              </CardHeader>
              <CardContent>{renderSettingInput(setting)}</CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
