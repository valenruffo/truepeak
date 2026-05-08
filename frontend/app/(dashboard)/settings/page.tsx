"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

const LEMON_SQUEEZY_URL = "https://truepeak.lemonsqueezy.com/checkout/buy/xxx";

export default function SettingsPage() {
  const router = useRouter();
  const { lang, setLang, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [plan, setPlan] = useState<string>("free");
  const [labelName, setLabelName] = useState<string>("");
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [logoutLoading, setLogoutLoading] = useState(false);

  useEffect(() => {
    const storedPlan = localStorage.getItem("plan") || "free";
    setPlan(storedPlan);

    const slug = localStorage.getItem("slug");
    if (slug) {
      fetch(`/api/labels/${slug}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data?.name) setLabelName(data.name);
        })
        .catch(() => {});
    }
  }, []);

  const handleCancelSubscription = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      setPlan("free");
      localStorage.setItem("plan", "free");
      setShowCancelModal(false);
    } catch (e: any) {
      setCancelError(e.message || t("settings.cancel_modal.error"));
    } finally {
      setCancelling(false);
    }
  };

  const handleLogout = () => {
    setLogoutLoading(true);
    localStorage.removeItem("slug");
    localStorage.removeItem("label_id");
    localStorage.removeItem("plan");
    localStorage.removeItem("token");
    fetch(`/api/labels/logout`, { method: "POST", credentials: "include" })
      .catch(() => {})
      .finally(() => {
        router.push("/");
      });
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">{t("settings.section_label")}</div>
      <h1 className="font-display font-semibold text-2xl mb-8">{t("settings.title")}</h1>

      {/* Plan Section */}
      <div className="rounded border p-6 mb-6" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
        <div className="text-xs font-mono uppercase tracking-wider text-muted mb-4">{t("settings.plan_label")}</div>

        <div className="flex items-center gap-3 mb-4">
          <span
            className="px-2.5 py-1 rounded text-xs font-semibold uppercase tracking-wider"
            style={{
              background: plan === "pro" ? "rgba(16,185,129,0.12)" : plan === "indie" ? "rgba(16,185,129,0.08)" : "rgba(161,161,170,0.1)",
              color: plan === "pro" || plan === "indie" ? "#10b981" : "var(--text-secondary)",
            }}
          >
            {plan === "pro" ? t("settings.plan_pro") : plan === "indie" ? "Plan Indie" : t("settings.plan_free")}
          </span>
          {(plan === "pro" || plan === "indie") && (
            <span className="text-xs text-muted">{t("settings.plan_renew")}</span>
          )}
        </div>

        {plan === "free" && (
          <div className="mb-4">
            <p className="text-sm text-muted mb-3">{t("settings.upgrade_desc")}</p>
            <a href={LEMON_SQUEEZY_URL} target="_blank" rel="noopener noreferrer" className="inline-block px-5 py-2.5 rounded text-sm font-medium transition-all hover:opacity-90" style={{ background: "#10b981", color: "#09090b" }}>
              {t("settings.upgrade_cta")}
            </a>
          </div>
        )}

        {(plan === "pro" || plan === "indie") && (
          <div className="mb-4">
            <button onClick={() => setShowCancelModal(true)} className="px-5 py-2.5 rounded text-sm font-medium border transition-all hover:opacity-80" style={{ borderColor: "var(--border)", color: "var(--text-secondary)", background: "transparent" }}>
              {t("settings.cancel")}
            </button>
          </div>
        )}

        {/* Features comparison */}
        <div className="rounded border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--bg-secondary)" }}>
                <th className="text-left px-4 py-3 font-mono text-xs uppercase tracking-wider text-muted">{t("settings.feature")}</th>
                <th className="text-center px-4 py-3 font-mono text-xs uppercase tracking-wider text-muted">Free</th>
                <th className="text-center px-4 py-3 font-mono text-xs uppercase tracking-wider" style={{ color: "#10b981" }}>Indie</th>
                <th className="text-center px-4 py-3 font-mono text-xs uppercase tracking-wider" style={{ color: "#10b981" }}>Pro</th>
              </tr>
            </thead>
            <tbody>
              {[
                { feature: t("settings.feature.tracks"), free: "10/mes", indie: "100/mes", pro: t("settings.unlimited") },
                { feature: t("settings.feature.storage"), free: "0", indie: "7 días", pro: "14 días" },
                { feature: t("settings.feature.emails"), free: "✕", indie: "100/mes", pro: "500/mes" },
                { feature: t("settings.feature.link"), free: "✓", indie: "✓", pro: "✓" },
                { feature: t("settings.feature.support"), free: "Email", indie: "Email", pro: "WhatsApp" },
              ].map((row, i) => (
                <tr key={row.feature} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-4 py-3">{row.feature}</td>
                  <td className="px-4 py-3 text-center text-muted">{row.free}</td>
                  <td className="px-4 py-3 text-center" style={{ color: "#10b981" }}>{row.indie}</td>
                  <td className="px-4 py-3 text-center" style={{ color: "#10b981" }}>{row.pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Appearance Section */}
      <div className="rounded border p-6 mb-6" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
        <div className="text-xs font-mono uppercase tracking-wider text-muted mb-4">{t("settings.appearance_label")}</div>

        <div className="space-y-5">
          {/* Language */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{t("settings.language")}</div>
              <div className="text-xs text-muted">{t("settings.language_desc")}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-1 rounded ${lang === "es" ? "font-semibold" : "text-muted"}`} style={lang === "es" ? { color: "#10b981" } : {}}>
                Español
              </span>
              <button
                onClick={() => setLang(lang === "es" ? "en" : "es")}
                className="relative w-11 h-6 rounded-full transition-colors"
                style={{ background: lang === "en" ? "#10b981" : "var(--border)" }}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform"
                  style={{ background: "var(--text-primary)", transform: lang === "en" ? "translateX(20px)" : "translateX(0)" }}
                />
              </button>
              <span className={`text-xs px-2 py-1 rounded ${lang === "en" ? "font-semibold" : "text-muted"}`} style={lang === "en" ? { color: "#10b981" } : {}}>
                English
              </span>
            </div>
          </div>

          {/* Theme */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{t("settings.theme")}</div>
              <div className="text-xs text-muted">{t("settings.theme_desc")}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-1 rounded ${theme === "dark" ? "font-semibold" : "text-muted"}`} style={theme === "dark" ? { color: "#10b981" } : {}}>
                Dark
              </span>
              <button
                onClick={toggleTheme}
                className="relative w-11 h-6 rounded-full transition-colors"
                style={{ background: theme === "light" ? "#10b981" : "var(--border)" }}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform"
                  style={{ background: "var(--text-primary)", transform: theme === "light" ? "translateX(20px)" : "translateX(0)" }}
                />
              </button>
              <span className={`text-xs px-2 py-1 rounded ${theme === "light" ? "font-semibold" : "text-muted"}`} style={theme === "light" ? { color: "#10b981" } : {}}>
                Light
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Logout */}
      <div className="rounded border p-6" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
        <div className="text-xs font-mono uppercase tracking-wider text-muted mb-4">{t("settings.session_label")}</div>
        <button
          onClick={handleLogout}
          disabled={logoutLoading}
          className="px-5 py-2.5 rounded text-sm font-medium border transition-all hover:opacity-80 disabled:opacity-50"
          style={{ borderColor: "rgba(239,68,68,0.3)", color: "#ef4444", background: "transparent" }}
        >
          {logoutLoading ? t("settings.logoutting") : t("settings.logout")}
        </button>
      </div>

      {/* Cancel confirmation modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" style={{ background: "rgba(0,0,0,0.7)" }}>
          <div className="w-full max-w-md rounded border p-6" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <div className="flex items-center gap-3 mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#facc15" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <h2 className="text-lg font-semibold">{t("settings.cancel_modal.title")}</h2>
            </div>
            <p className="text-sm text-muted mb-6">{t("settings.cancel_modal.desc")}</p>
            {cancelError && (
              <div className="mb-4 px-4 py-3 rounded text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}>
                {cancelError}
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setShowCancelModal(false); setCancelError(null); }} className="px-5 py-2.5 rounded text-sm font-medium border transition-all hover:opacity-80" style={{ borderColor: "var(--border)", color: "var(--text-secondary)", background: "transparent" }}>
                {t("settings.cancel_modal.keep")}
              </button>
              <button onClick={handleCancelSubscription} disabled={cancelling} className="px-5 py-2.5 rounded text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50" style={{ background: "#ef4444", color: "var(--text-primary)" }}>
                {cancelling ? t("settings.cancel_modal.cancelling") : t("settings.cancel_modal.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
