"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { getBillingDetails, createPortalSession, BillingDetails } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Loader2 } from "lucide-react";

const POLAR_CHECKOUT_INDIE = "https://buy.polar.sh/polar_cl_HmWbpa6oeLs6vcSucDQR5rlWXMPsne5p33MOi2RZPFg";
const POLAR_CHECKOUT_PRO = "https://buy.polar.sh/polar_cl_4u3xFxj5G4klKE5jhYIDGMXmhyL7kjaTQe9Ux34e9Wb";

export default function SettingsPage() {
  const router = useRouter();
  const { lang, setLang, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [plan, setPlan] = useState<string>("free");
  const [labelName, setLabelName] = useState<string>("");
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [labelSlug, setLabelSlug] = useState<string>("");
  const [labelEmail, setLabelEmail] = useState<string>("");
  const [billing, setBilling] = useState<BillingDetails | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const { addToast } = useToast();

  useEffect(() => {
    const storedPlan = localStorage.getItem("plan") || "free";
    setPlan(storedPlan);

    const slug = localStorage.getItem("slug");
    if (slug) {
      setLabelSlug(slug);
      // Fetch label info
      fetch(`/api/labels/${slug}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data?.name) setLabelName(data.name);
          if (data?.owner_email) setLabelEmail(data.owner_email);
          if (data?.plan && data.plan !== storedPlan) {
            setPlan(data.plan);
            localStorage.setItem("plan", data.plan);
          }
        })
        .catch(() => {});

      // Fetch billing details
      getBillingDetails(slug)
        .then(setBilling)
        .catch(() => {});
    }
  }, []);

  const handleManageSubscription = async (actionId: string) => {
    if (!labelSlug) return;
    setLoadingAction(actionId);
    try {
      const { url } = await createPortalSession(labelSlug);
      window.location.href = url;
    } catch (err) {
      addToast({
        title: "Error",
        description: "Error al abrir el portal de Polar. Intentá más tarde.",
        variant: "destructive"
      });
      setLoadingAction(null);
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

  const getCheckoutUrl = (baseUrl: string) => {
    if (!labelSlug) return baseUrl;
    const url = new URL(baseUrl);
    if (labelEmail) url.searchParams.append("customer_email", labelEmail);
    // Add metadata with slug so backend updates the correct account regardless of the email entered
    url.searchParams.append("metadata", JSON.stringify({ slug: labelSlug }));
    return url.toString();
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
          {billing?.next_billing_date && (
            <span className="text-xs text-muted">
              {t("settings.plan_renew")} {new Date(billing.next_billing_date).toLocaleDateString()}
              {billing.amount && ` por $${(billing.amount / 100).toFixed(0)}`}
            </span>
          )}
        </div>

        {plan === "free" && (
          <div className="mb-4">
            <p className="text-sm text-muted mb-3">{t("settings.upgrade_desc")}</p>
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
            <tfoot>
              <tr style={{ borderTop: "1px solid var(--border)" }}>
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-center text-xs text-muted uppercase font-mono">
                  {plan === "free" ? "Actual" : "Gratis"}
                </td>
                <td className="px-4 py-3 text-center">
                  {plan === "free" ? (
                    <a
                      href={getCheckoutUrl(POLAR_CHECKOUT_INDIE)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block px-4 py-2 rounded text-xs font-medium transition-all hover:opacity-90"
                      style={{ background: "#10b981", color: "#09090b" }}
                    >
                      Suscribirse — $12/mes
                    </a>
                  ) : plan === "indie" ? (
                    <button
                      onClick={() => handleManageSubscription("cancel_indie")}
                      disabled={!!loadingAction}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded text-xs font-medium transition-all border border-red-500/30 text-red-500 hover:bg-red-500/5 disabled:opacity-50 min-w-[140px]"
                    >
                      {loadingAction === "cancel_indie" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Cancelar suscripción"}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleManageSubscription("downgrade_indie")}
                      disabled={!!loadingAction}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded text-xs font-medium transition-all border border-[#10b981]/30 text-[#10b981] hover:bg-[#10b981]/5 disabled:opacity-50 min-w-[140px]"
                    >
                      {loadingAction === "downgrade_indie" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Bajar plan"}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {plan === "pro" ? (
                    <button
                      onClick={() => handleManageSubscription("cancel_pro")}
                      disabled={!!loadingAction}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded text-xs font-medium transition-all border border-red-500/30 text-red-500 hover:bg-red-500/5 disabled:opacity-50 min-w-[140px]"
                    >
                      {loadingAction === "cancel_pro" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Cancelar suscripción"}
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        if (plan === "indie") {
                          handleManageSubscription("upgrade_pro");
                        } else {
                          window.open(getCheckoutUrl(POLAR_CHECKOUT_PRO), "_blank");
                        }
                      }}
                      disabled={!!loadingAction}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded text-xs font-medium transition-all hover:opacity-90 disabled:opacity-50 min-w-[140px]"
                      style={{ background: "#10b981", color: "#09090b" }}
                    >
                      {loadingAction === "upgrade_pro" ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        plan === "indie" ? "Subir plan" : "Suscribirse — $29/mes"
                      )}
                    </button>
                  )}
                </td>
              </tr>
            </tfoot>
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
    </div>
  );
}
