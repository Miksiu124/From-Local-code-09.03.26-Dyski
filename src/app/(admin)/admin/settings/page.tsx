"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Save, Webhook, CreditCard, Timer, Package, Coins, UserPlus, ClipboardList, Send } from "lucide-react";
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
const FEATURED_KEYS = [
  "blik_enabled",
  "discord_webhook_url",
  "discord_ping_role_id",
  "paypal_address",
  "revolut_address",
  "blik_expiration_minutes",
  "bundle_credit_cost_14d",
  "bundle_credit_cost_30d",
  "crypto_expiration_hours",
  "crypto_wallets",
  "referral_credits_referrer",
  "referral_bonus_percent_referee",
  "referral_max_per_user",
  "referral_min_purchase_amount",
  "referral_cooldown_hours",
  "custom_order_price_main_private",
  "custom_order_price_main_public",
  "custom_order_price_main_ppv_private",
  "custom_order_price_main_ppv_public",
];
const HIDDEN_KEYS = ["blik_enabled"];

export default function AdminSettingsPage() {
  const t = useTranslations("admin");
  const [settings, setSettings] = useState<SettingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [notifTitle, setNotifTitle] = useState("");
  const [notifMessage, setNotifMessage] = useState("");
  const [notifType, setNotifType] = useState("ADMIN_BROADCAST");
  const [notifTargetMode, setNotifTargetMode] = useState<"all" | "email" | "userId">("all");
  const [notifEmail, setNotifEmail] = useState("");
  const [notifUserId, setNotifUserId] = useState("");
  const [sendingNotif, setSendingNotif] = useState(false);
  const [notifSendMessage, setNotifSendMessage] = useState("");

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
        const data = await res.json().catch(() => ({}));
        const msg = (data as { message?: string })?.message || (data as { error?: string })?.error || "Failed to save settings";
        setMessage(msg);
      }
    } catch {
      setMessage("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleSendAdminNotification = async () => {
    if (!notifTitle.trim() || !notifMessage.trim()) {
      setNotifSendMessage("Title and message are required");
      return;
    }
    setSendingNotif(true);
    setNotifSendMessage("");
    try {
      const payload: Record<string, unknown> = {
        type: notifType,
        title: notifTitle.trim(),
        message: notifMessage.trim(),
        broadcast: notifTargetMode === "all",
      };
      if (notifTargetMode === "email") payload.email = notifEmail.trim();
      if (notifTargetMode === "userId") payload.userId = notifUserId.trim();
      const res = await fetch("/api/admin/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotifSendMessage((data as { message?: string })?.message || "Failed to send notification");
        return;
      }
      setNotifSendMessage(`Sent to ${(data as { recipientCount?: number })?.recipientCount ?? 0} user(s)`);
      setNotifTitle("");
      setNotifMessage("");
      if (notifTargetMode !== "all") {
        setNotifEmail("");
        setNotifUserId("");
      }
    } catch {
      setNotifSendMessage("Failed to send notification");
    } finally {
      setSendingNotif(false);
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
            enabled ? "bg-green-500" : "bg-muted"
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
          {(["BTC", "ETH", "LTC", "USDC"] as const).map((currency) => (
            <div key={currency} className="flex items-center gap-2">
              <span className="text-sm font-mono w-12">{currency}</span>
              <Input
                value={wallets[currency] ?? ""}
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
  const discordPingRoleSetting = settings.find((s) => s.key === "discord_ping_role_id");
  const paypalSetting = settings.find((s) => s.key === "paypal_address");
  const revolutSetting = settings.find((s) => s.key === "revolut_address");
  const blikExpirationSetting = settings.find((s) => s.key === "blik_expiration_minutes");
  const bundle14dSetting = settings.find((s) => s.key === "bundle_credit_cost_14d");
  const bundle30dSetting = settings.find((s) => s.key === "bundle_credit_cost_30d");
  const cryptoExpirationSetting = settings.find((s) => s.key === "crypto_expiration_hours");
  const cryptoWalletsSetting = settings.find((s) => s.key === "crypto_wallets");
  const referralCreditsReferrer = settings.find((s) => s.key === "referral_credits_referrer");
  const referralBonusReferee = settings.find((s) => s.key === "referral_bonus_percent_referee");
  const referralMaxPerUser = settings.find((s) => s.key === "referral_max_per_user");
  const referralMinPurchase = settings.find((s) => s.key === "referral_min_purchase_amount");
  const referralCooldown = settings.find((s) => s.key === "referral_cooldown_hours");
  const customPriceMainPrivate = settings.find((s) => s.key === "custom_order_price_main_private");
  const customPriceMainPublic = settings.find((s) => s.key === "custom_order_price_main_public");
  const customPriceMainPpvPrivate = settings.find((s) => s.key === "custom_order_price_main_ppv_private");
  const customPriceMainPpvPublic = settings.find((s) => s.key === "custom_order_price_main_ppv_public");
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

      <Card className="mb-6 border-2 border-cyan-500/20">
        <CardContent className="p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/10">
              <Send className="h-6 w-6 text-cyan-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">User notifications</h3>
              <p className="text-sm text-muted-foreground">
                Send in-app notifications to all users or one selected account.
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                Notification title
              </label>
              <Input
                value={notifTitle}
                onChange={(e) => setNotifTitle(e.target.value)}
                maxLength={140}
                placeholder="Title visible to users"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                Notification message
              </label>
              <textarea
                value={notifMessage}
                onChange={(e) => setNotifMessage(e.target.value)}
                maxLength={1500}
                placeholder="Message content"
                className="min-h-[110px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                Type
              </label>
              <Input
                value={notifType}
                onChange={(e) => setNotifType(e.target.value.toUpperCase())}
                placeholder="ADMIN_BROADCAST"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                Target
              </label>
              <select
                value={notifTargetMode}
                onChange={(e) => setNotifTargetMode(e.target.value as "all" | "email" | "userId")}
                className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">All users (broadcast)</option>
                <option value="email">Single user by email</option>
                <option value="userId">Single user by ID</option>
              </select>
            </div>
            {notifTargetMode === "email" && (
              <div className="sm:col-span-2">
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                  User email
                </label>
                <Input
                  value={notifEmail}
                  onChange={(e) => setNotifEmail(e.target.value)}
                  placeholder="user@example.com"
                />
              </div>
            )}
            {notifTargetMode === "userId" && (
              <div className="sm:col-span-2">
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                  User ID (UUID)
                </label>
                <Input
                  value={notifUserId}
                  onChange={(e) => setNotifUserId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="font-mono text-sm"
                />
              </div>
            )}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={handleSendAdminNotification} disabled={sendingNotif}>
              <Send className="h-4 w-4 mr-2" />
              {sendingNotif ? "Sending..." : "Send notification"}
            </Button>
            {notifSendMessage && (
              <span className="text-sm text-muted-foreground">{notifSendMessage}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Discord Webhook Card */}
      {(discordSetting || discordPingRoleSetting) && (
        <Card className="mb-6 border-2 border-indigo-500/20">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10">
                <Webhook className="h-6 w-6 text-indigo-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Discord Webhook</h3>
                <p className="text-sm text-muted-foreground">
                  Receive payment notifications on your Discord server. Role ID = @mention przy embedzie powiadomień.
                </p>
              </div>
            </div>
            <div className="space-y-4">
              {discordSetting && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Webhook URL
                  </label>
                  <Input
                    value={String(discordSetting.value || "")}
                    onChange={(e) => updateSetting("discord_webhook_url", e.target.value)}
                    placeholder="https://discord.com/api/webhooks/..."
                    className="font-mono text-sm"
                  />
                </div>
              )}
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                  Role ID (ping przy embedzie)
                </label>
                <Input
                  value={String(discordPingRoleSetting?.value ?? "")}
                  onChange={(e) => {
                    const val = e.target.value;
                    const existing = settings.find((s) => s.key === "discord_ping_role_id");
                    if (existing) {
                      updateSetting("discord_ping_role_id", val);
                    } else {
                      setSettings((prev) => [...prev, { key: "discord_ping_role_id", value: val, description: null }]);
                    }
                  }}
                  placeholder="1476402661698834502"
                  className="font-mono text-sm"
                />
              </div>
            </div>
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

      {/* BLIK Settings */}
      {blikExpirationSetting && (
        <Card className="mb-6 border-2 border-amber-500/20">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
                <Timer className="h-6 w-6 text-amber-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">BLIK</h3>
                <p className="text-sm text-muted-foreground">
                  Czas ważności płatności BLIK w minutach.
                </p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                  Czas wygaśnięcia (minuty)
                </label>
                <Input
                  type="number"
                  value={Number(blikExpirationSetting.value) || ""}
                  onChange={(e) => updateSetting("blik_expiration_minutes", Number(e.target.value))}
                  placeholder="5"
                  className="font-mono text-sm"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bundle Credit Costs */}
      {(bundle14dSetting || bundle30dSetting) && (
        <Card className="mb-6 border-2 border-blue-500/20">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10">
                <Package className="h-6 w-6 text-blue-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Pakiety kredytów</h3>
                <p className="text-sm text-muted-foreground">
                  Koszt dostępu do wszystkich modeli na wybrany okres.
                </p>
              </div>
            </div>
            <div className="space-y-4">
              {bundle14dSetting && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    14 dni (kredyty)
                  </label>
                  <Input
                    type="number"
                    value={Number(bundle14dSetting.value) || ""}
                    onChange={(e) => updateSetting("bundle_credit_cost_14d", Number(e.target.value))}
                    placeholder="500"
                    className="font-mono text-sm"
                  />
                </div>
              )}
              {bundle30dSetting && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    30 dni (kredyty)
                  </label>
                  <Input
                    type="number"
                    value={Number(bundle30dSetting.value) || ""}
                    onChange={(e) => updateSetting("bundle_credit_cost_30d", Number(e.target.value))}
                    placeholder="900"
                    className="font-mono text-sm"
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Crypto Settings */}
      {(cryptoExpirationSetting || cryptoWalletsSetting) && (
        <Card className="mb-6 border-2 border-orange-500/20">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10">
                <Coins className="h-6 w-6 text-orange-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Kryptowaluty</h3>
                <p className="text-sm text-muted-foreground">
                  Czas oczekiwania na płatność oraz adresy portfeli.
                </p>
              </div>
            </div>
            <div className="space-y-4">
              {cryptoExpirationSetting && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Czas oczekiwania (godziny)
                  </label>
                  <Input
                    type="number"
                    value={Number(cryptoExpirationSetting.value) || ""}
                    onChange={(e) => updateSetting("crypto_expiration_hours", Number(e.target.value))}
                    placeholder="48"
                    className="font-mono text-sm"
                  />
                </div>
              )}
              {cryptoWalletsSetting && typeof cryptoWalletsSetting.value === "object" && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Adresy portfeli
                  </label>
                  <div className="space-y-2">
                    {(["BTC", "ETH", "LTC", "USDC"] as const).map((currency) => {
                      const wallets = cryptoWalletsSetting.value as Record<string, string>;
                      const address = wallets[currency] ?? "";
                      return (
                      <div key={currency} className="flex items-center gap-2">
                        <span className="text-sm font-mono w-12">{currency}</span>
                        <Input
                          value={address}
                          onChange={(e) => {
                            const wallets = cryptoWalletsSetting.value as Record<string, string>;
                            updateSetting("crypto_wallets", { ...wallets, [currency]: e.target.value });
                          }}
                          placeholder={`${currency} wallet address`}
                          className="flex-1 font-mono text-sm"
                        />
                      </div>
                    );})}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Custom Orders Pricing */}
      {(customPriceMainPrivate || customPriceMainPublic || customPriceMainPpvPrivate || customPriceMainPpvPublic) && (
        <Card className="mb-6 border-2 border-fuchsia-500/20">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-fuchsia-500/10">
                <ClipboardList className="h-6 w-6 text-fuchsia-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Custom orders pricing</h3>
                <p className="text-sm text-muted-foreground">
                  Pricing shown on user Customs tab and charged instantly on submit.
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {customPriceMainPrivate && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Main only · Private
                  </label>
                  <Input
                    type="number"
                    value={customPriceMainPrivate.value != null ? Number(customPriceMainPrivate.value) : ""}
                    onChange={(e) => updateSetting("custom_order_price_main_private", Number(e.target.value))}
                    placeholder="250"
                    className="font-mono text-sm"
                  />
                </div>
              )}
              {customPriceMainPublic && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Main only · Publish to site
                  </label>
                  <Input
                    type="number"
                    value={customPriceMainPublic.value != null ? Number(customPriceMainPublic.value) : ""}
                    onChange={(e) => updateSetting("custom_order_price_main_public", Number(e.target.value))}
                    placeholder="450"
                    className="font-mono text-sm"
                  />
                </div>
              )}
              {customPriceMainPpvPrivate && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Main + PPV · Private
                  </label>
                  <Input
                    type="number"
                    value={customPriceMainPpvPrivate.value != null ? Number(customPriceMainPpvPrivate.value) : ""}
                    onChange={(e) => updateSetting("custom_order_price_main_ppv_private", Number(e.target.value))}
                    placeholder="400"
                    className="font-mono text-sm"
                  />
                </div>
              )}
              {customPriceMainPpvPublic && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Main + PPV · Publish to site
                  </label>
                  <Input
                    type="number"
                    value={customPriceMainPpvPublic.value != null ? Number(customPriceMainPpvPublic.value) : ""}
                    onChange={(e) => updateSetting("custom_order_price_main_ppv_public", Number(e.target.value))}
                    placeholder="650"
                    className="font-mono text-sm"
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Referral Settings */}
      {(referralCreditsReferrer || referralBonusReferee || referralMaxPerUser || referralMinPurchase || referralCooldown) && (
        <Card className="mb-6 border-2 border-primary/20">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <UserPlus className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Referral</h3>
                <p className="text-sm text-muted-foreground">
                  Program poleceń – nagrody dla polecającego i poleconego przy pierwszym zakupie.
                </p>
              </div>
            </div>
            <div className="space-y-4">
              {referralCreditsReferrer && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Kredyty dla polecającego (za każdego poleconego)
                  </label>
                  <Input
                    type="number"
                    value={referralCreditsReferrer.value != null ? Number(referralCreditsReferrer.value) : ""}
                    onChange={(e) => updateSetting("referral_credits_referrer", Number(e.target.value))}
                    placeholder="50"
                    className="font-mono text-sm"
                  />
                </div>
              )}
              {referralBonusReferee && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Bonus % dla poleconego (przy pierwszym zakupie)
                  </label>
                  <Input
                    type="number"
                    value={referralBonusReferee.value != null ? Number(referralBonusReferee.value) : ""}
                    onChange={(e) => updateSetting("referral_bonus_percent_referee", Number(e.target.value))}
                    placeholder="10"
                    className="font-mono text-sm"
                  />
                </div>
              )}
              {referralMaxPerUser && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Maks. poleconych na użytkownika
                  </label>
                  <Input
                    type="number"
                    value={referralMaxPerUser.value != null ? Number(referralMaxPerUser.value) : ""}
                    onChange={(e) => updateSetting("referral_max_per_user", Number(e.target.value))}
                    placeholder="100"
                    className="font-mono text-sm"
                  />
                </div>
              )}
              {referralMinPurchase && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Min. kwota zakupu (PLN) do naliczenia
                  </label>
                  <Input
                    type="number"
                    value={referralMinPurchase.value != null ? Number(referralMinPurchase.value) : ""}
                    onChange={(e) => updateSetting("referral_min_purchase_amount", Number(e.target.value))}
                    placeholder="0"
                    className="font-mono text-sm"
                  />
                </div>
              )}
              {referralCooldown && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Cooldown (godziny) – 0 = jednorazowo
                  </label>
                  <Input
                    type="number"
                    value={referralCooldown.value != null ? Number(referralCooldown.value) : ""}
                    onChange={(e) => updateSetting("referral_cooldown_hours", Number(e.target.value))}
                    placeholder="0"
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
