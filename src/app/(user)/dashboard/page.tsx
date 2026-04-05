"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Coins,
  FolderOpen,
  User,
  Mail,
  Lock,
  Play,
  Save,
  Loader2,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import { formatCredits } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Link from "next/link";

type UserProfile = {
  name: string;
  email: string;
  autoplay: boolean;
  hasPassword: boolean;
};

type MeResponse = {
  id: string;
  name: string;
  email: string;
  creditBalance: number;
  role: string;
  emailVerified?: boolean;
};

type AccessResponse = {
  hasBundle: boolean;
  modelIds: string[];
};

type StatsResponse = {
  totalModels: number;
};

function StatusMessage({ type, message }: { type: "success" | "error"; message: string }) {
  return (
    <div
      className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
        type === "success"
          ? "bg-green-500/10 text-green-400 border border-green-500/20"
          : "bg-red-500/10 text-red-400 border border-red-500/20"
      }`}
    >
      {type === "success" ? <Check className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      {message}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const t = useTranslations("dashboard");
  const tAuth = useTranslations("auth");

  const [me, setMe] = useState<MeResponse | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [accessCount, setAccessCount] = useState(0);
  const [hasBundle, setHasBundle] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form states
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [autoplay, setAutoplay] = useState(false);

  const [showEmailPassword, setShowEmailPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Saving states
  const [savingName, setSavingName] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingAutoplay, setSavingAutoplay] = useState(false);

  // Status messages
  const [nameStatus, setNameStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [emailStatus, setEmailStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [autoplayStatus, setAutoplayStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [resendVerifyLoading, setResendVerifyLoading] = useState(false);
  const [verifyResendStatus, setVerifyResendStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [resendVerifyCooldownSec, setResendVerifyCooldownSec] = useState(0);

  useEffect(() => {
    if (resendVerifyCooldownSec <= 0) return;
    const id = setInterval(() => {
      setResendVerifyCooldownSec((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [resendVerifyCooldownSec]);

  useEffect(() => {
    async function load() {
      try {
        const meRes = await fetch("/api/auth/me");
        if (!meRes.ok) {
          router.push("/login");
          return;
        }
        const meData = await meRes.json();
        setMe(meData);

        const [profileRes, accessRes, statsRes] = await Promise.all([
          fetch("/api/user/profile"),
          fetch("/api/user/access"),
          fetch("/api/models/stats"),
        ]);

        if (profileRes.ok) {
          const p = await profileRes.json();
          setProfile(p);
          setName(p.name || "");
          setEmail(p.email || "");
          setAutoplay(p.autoplay || false);
        }

        if (accessRes.ok) {
          const a: AccessResponse = await accessRes.json();
          setHasBundle(a.hasBundle);
          if (a.hasBundle && statsRes.ok) {
            const s: StatsResponse = await statsRes.json();
            setAccessCount(s.totalModels);
          } else {
            setAccessCount(a.modelIds?.length || 0);
          }
        }
      } catch {
        router.push("/login");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  const clearStatus = (setter: (v: null) => void) => {
    setTimeout(() => setter(null), 4000);
  };

  const handleSaveName = async () => {
    if (!name.trim()) return;
    setSavingName(true);
    setNameStatus(null);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setNameStatus({ type: "success", message: "Nickname updated" });
        window.dispatchEvent(new CustomEvent("auth-change"));
      } else {
        setNameStatus({ type: "error", message: data.error || "Failed to update" });
      }
    } catch {
      setNameStatus({ type: "error", message: "Network error" });
    } finally {
      setSavingName(false);
      clearStatus(setNameStatus);
    }
  };

  const handleSaveEmail = async () => {
    if (!email.trim() || !emailPassword) return;
    setSavingEmail(true);
    setEmailStatus(null);
    try {
      const res = await fetch("/api/user/email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password: emailPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setEmailStatus({ type: "success", message: "Email updated" });
        setEmailPassword("");
        window.dispatchEvent(new CustomEvent("auth-change"));
      } else {
        setEmailStatus({ type: "error", message: data.error || "Failed to update" });
      }
    } catch {
      setEmailStatus({ type: "error", message: "Network error" });
    } finally {
      setSavingEmail(false);
      clearStatus(setEmailStatus);
    }
  };

  const handleSavePassword = async () => {
    if (!currentPassword || !newPassword) return;
    if (newPassword !== confirmPassword) {
      setPasswordStatus({ type: "error", message: "Passwords do not match" });
      clearStatus(setPasswordStatus);
      return;
    }
    setSavingPassword(true);
    setPasswordStatus(null);
    try {
      const res = await fetch("/api/user/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setPasswordStatus({ type: "success", message: "Password updated" });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setPasswordStatus({ type: "error", message: data.error || "Failed to update" });
      }
    } catch {
      setPasswordStatus({ type: "error", message: "Network error" });
    } finally {
      setSavingPassword(false);
      clearStatus(setPasswordStatus);
    }
  };

  const handleToggleAutoplay = async () => {
    const newValue = !autoplay;
    setSavingAutoplay(true);
    setAutoplayStatus(null);
    try {
      const res = await fetch("/api/user/autoplay", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoplay: newValue }),
      });
      if (res.ok) {
        setAutoplay(newValue);
        setAutoplayStatus({ type: "success", message: newValue ? "Autoplay enabled" : "Autoplay disabled" });
      } else {
        setAutoplayStatus({ type: "error", message: "Failed to update" });
      }
    } catch {
      setAutoplayStatus({ type: "error", message: "Network error" });
    } finally {
      setSavingAutoplay(false);
      clearStatus(setAutoplayStatus);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!me) return null;

  const isOAuth = profile && !profile.hasPassword;

  const handleResendVerification = async () => {
    setResendVerifyLoading(true);
    setVerifyResendStatus(null);
    try {
      const res = await fetch("/api/auth/resend-verification", { method: "POST", credentials: "include" });
      const data = (await res.json()) as { error?: string; message?: string };
      if (res.status === 429) {
        const ra = res.headers.get("Retry-After");
        const secs = ra ? Math.max(1, parseInt(ra, 10) || 0) : 0;
        if (secs > 0) setResendVerifyCooldownSec(secs);
        setVerifyResendStatus({
          type: "error",
          message: data.message || data.error || "Too many requests",
        });
        return;
      }
      if (res.ok) {
        setVerifyResendStatus({ type: "success", message: data.message || "Verification email sent. Check your inbox." });
        setResendVerifyCooldownSec(120);
      } else {
        setVerifyResendStatus({ type: "error", message: data.message || data.error || "Failed to send" });
      }
    } catch {
      setVerifyResendStatus({ type: "error", message: "Network error" });
    } finally {
      setResendVerifyLoading(false);
      setTimeout(() => setVerifyResendStatus(null), 4000);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      {me && !me.emailVerified && (
        <div className="mb-6 rounded-xl bg-yellow-500/10 border border-yellow-500/20 p-4 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-yellow-200">{tAuth("verifyEmailRequired")}</p>
            <Button
            variant="outline"
            size="sm"
            className="border-yellow-500/30 text-yellow-200 hover:bg-yellow-500/10 shrink-0 gap-2"
            disabled={resendVerifyLoading || resendVerifyCooldownSec > 0}
            onClick={handleResendVerification}
          >
            {resendVerifyLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {resendVerifyCooldownSec > 0
              ? tAuth("resendVerificationWait", { seconds: resendVerifyCooldownSec })
              : tAuth("resendVerification")}
          </Button>
          </div>
          {verifyResendStatus && (
            <div className="text-sm flex items-center gap-2">
              {verifyResendStatus.type === "success" ? (
                <Check className="h-4 w-4 text-green-400 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              )}
              <span className={verifyResendStatus.type === "success" ? "text-green-400" : "text-red-400"}>
                {verifyResendStatus.message}
              </span>
            </div>
          )}
        </div>
      )}
      <h1 className="text-2xl sm:text-3xl font-bold mb-8 slide-up">{t("title")}</h1>

      {/* Stats */}
      <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 mb-10">
        <div className="glass-panel p-5 sm:p-6 rounded-2xl relative overflow-hidden group animate-in fade-in stagger-1">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Coins className="h-20 w-20 text-primary" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Credit Balance</h3>
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Coins className="h-4 w-4 text-primary" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-white mb-2">{formatCredits(me.creditBalance)}</div>
            <Link
              href="/purchase"
              className="inline-flex items-center text-xs text-primary hover:text-primary/80 font-medium transition-colors gap-1"
            >
              Buy more credits <span>→</span>
            </Link>
          </div>
        </div>

        <div className="glass-panel p-5 sm:p-6 rounded-2xl relative overflow-hidden group animate-in fade-in stagger-2">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <FolderOpen className="h-20 w-20 text-blue-500" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Content Access</h3>
              <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <FolderOpen className="h-4 w-4 text-blue-500" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-white mb-2">
              {hasBundle ? "All" : accessCount}
            </div>
            <p className="text-xs text-muted-foreground">
              {hasBundle ? "Unlimited access active" : "models accessible"}
            </p>
          </div>
        </div>
      </div>

      {/* Settings Sections */}
      <div className="space-y-6">
        {/* Nickname */}
        <div className="glass-panel rounded-2xl p-5 sm:p-6 slide-up" style={{ animationDelay: "0.1s" }}>
          <div className="flex items-center gap-2 mb-4">
            <User className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">Nickname</h2>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              placeholder="Your display name"
              className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50 transition-all"
            />
            <button
              onClick={handleSaveName}
              disabled={savingName || !name.trim()}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground rounded-xl text-sm font-medium transition-colors cursor-pointer"
            >
              {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
          {nameStatus && <div className="mt-3"><StatusMessage {...nameStatus} /></div>}
        </div>

        {/* Email */}
        <div className="glass-panel rounded-2xl p-5 sm:p-6 slide-up" style={{ animationDelay: "0.15s" }}>
          <div className="flex items-center gap-2 mb-4">
            <Mail className="h-5 w-5 text-blue-400" />
            <h2 className="text-base font-semibold">Email</h2>
          </div>
          {isOAuth ? (
            <p className="text-sm text-muted-foreground">
              Your account uses Discord login. Email changes are not available for OAuth accounts.
            </p>
          ) : (
            <>
              <div className="space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full bg-white/[0.05] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50 transition-all"
                />
                <div className="relative">
                  <input
                    type={showEmailPassword ? "text" : "password"}
                    value={emailPassword}
                    onChange={(e) => setEmailPassword(e.target.value)}
                    placeholder="Confirm with your password"
                    className="w-full bg-white/[0.05] border border-white/[0.08] rounded-xl px-4 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEmailPassword(!showEmailPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    {showEmailPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <button
                  onClick={handleSaveEmail}
                  disabled={savingEmail || !email.trim() || !emailPassword}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground rounded-xl text-sm font-medium transition-colors cursor-pointer"
                >
                  {savingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Update Email
                </button>
              </div>
              {emailStatus && <div className="mt-3"><StatusMessage {...emailStatus} /></div>}
            </>
          )}
        </div>

        {/* Password */}
        <div className="glass-panel rounded-2xl p-5 sm:p-6 slide-up" style={{ animationDelay: "0.2s" }}>
          <div className="flex items-center gap-2 mb-4">
            <Lock className="h-5 w-5 text-yellow-400" />
            <h2 className="text-base font-semibold">Password</h2>
          </div>
          {isOAuth ? (
            <p className="text-sm text-muted-foreground">
              Your account uses Discord login. Password changes are not available for OAuth accounts.
            </p>
          ) : (
            <>
              <div className="space-y-3">
                <div className="relative">
                  <input
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password"
                    className="w-full bg-white/[0.05] border border-white/[0.08] rounded-xl px-4 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password"
                    className="w-full bg-white/[0.05] border border-white/[0.08] rounded-xl px-4 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="w-full bg-white/[0.05] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/50 transition-all"
                />
                <p className="text-xs text-muted-foreground/60">
                  Min. 8 characters, at least one uppercase, one lowercase, and one number.
                </p>
                <button
                  onClick={handleSavePassword}
                  disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground rounded-xl text-sm font-medium transition-colors cursor-pointer"
                >
                  {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  Change Password
                </button>
              </div>
              {passwordStatus && <div className="mt-3"><StatusMessage {...passwordStatus} /></div>}
            </>
          )}
        </div>

        {/* Autoplay */}
        <div className="glass-panel rounded-2xl p-5 sm:p-6 slide-up" style={{ animationDelay: "0.25s" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                <Play className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Autoplay Videos</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Automatically start playing videos when you open them
                </p>
              </div>
            </div>
            <button
              onClick={handleToggleAutoplay}
              disabled={savingAutoplay}
              className={`relative w-12 h-7 rounded-full transition-colors duration-200 cursor-pointer ${
                autoplay ? "bg-green-500" : "bg-white/[0.1]"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ${
                  autoplay ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
          {autoplayStatus && <div className="mt-3"><StatusMessage {...autoplayStatus} /></div>}
        </div>
      </div>
    </div>
  );
}
