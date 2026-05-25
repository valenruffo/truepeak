"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { getBillingDetails, cancelSubscription, updateSubscription, BillingDetails } from "@/lib/api";
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
  const [subscriptionStatus, setSubscriptionStatus] = useState<string>("active");
  const [frozenAt, setFrozenAt] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingDetails | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const { addToast } = useToast();

  const fetchBilling = (slug: string) => {
    getBillingDetails(slug)
      .then(setBilling)
      .catch(() => {});
  };

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
          if (data?.plan) {
            const currentStoredPlan = localStorage.getItem("plan");
            setPlan(data.plan);
            if (currentStoredPlan !== data.plan) {
              localStorage.setItem("plan", data.plan);
              window.dispatchEvent(new Event("plan_updated"));
            }
          }
          if (data?.subscription_status) {
            setSubscriptionStatus(data.subscription_status);
          }
          if (data?.frozen_at) {
            setFrozenAt(data.frozen_at);
          }
        })
        .catch(() => {});

      // Fetch billing details
      fetchBilling(slug);
    }

    // Check for success message from Polar — poll backend until plan updates
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("success") === "true" && slug) {
      // Clean up URL immediately
      window.history.replaceState({}, document.title, window.location.pathname);

      // Poll backend for plan update (webhook may take a few seconds)
      const currentPlan = localStorage.getItem("plan") || "free";
      let attempts = 0;
      const maxAttempts = 8; // 8 * 2s = 16s max
      const pollInterval = setInterval(async () => {
        attempts++;
        try {
          const res = await fetch(`/api/labels/${slug}`);
          if (res.ok) {
            const data = await res.json();
            if (data?.plan && data.plan !== currentPlan) {
              // Plan updated!
              clearInterval(pollInterval);
              setPlan(data.plan);
              localStorage.setItem("plan", data.plan);
              window.dispatchEvent(new Event("plan_updated"));
              fetchBilling(slug);
              addToast({
                title: lang === "es" ? "¡Felicitaciones!" : "Congratulations!",
                description: lang === "es" 
                  ? `Tu plan se actualizó a ${data.plan.toUpperCase()}. ¡Disfrutá de True Peak!` 
                  : `Your plan was updated to ${data.plan.toUpperCase()}. Enjoy True Peak!`,
              });
              return;
            }
          }
        } catch {}

        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          addToast({
            title: lang === "es" ? "Pago procesado" : "Payment processed",
            description: lang === "es"
              ? "Tu pago se procesó correctamente. El plan puede tardar unos segundos en actualizarse. Refrescá la página si no ves el cambio."
              : "Your payment was processed successfully. The plan may take a few seconds to update. Refresh the page if you don't see the change.",
          });
        }
      }, 2000);

      return () => clearInterval(pollInterval);
    }
  }, []);

  const handleCancel = async (actionId: string) => {
    if (!labelSlug) return;
    setLoadingAction(actionId);
    try {
      await cancelSubscription(labelSlug);
      window.dispatchEvent(new Event("plan_updated")); // To trigger refetch in layout
      addToast({
        title: lang === "es" ? "Suscripción Cancelada" : "Subscription Cancelled",
        description: lang === "es" 
          ? "Tu plan se canceló. Mantendrás los beneficios Pro hasta el final de tu ciclo de facturación actual." 
          : "Your plan was cancelled. You will keep Pro benefits until the end of your current billing cycle.",
      });
      fetchBilling(labelSlug);
    } catch (err) {
      addToast({
        title: "Error",
        description: lang === "es" ? "No se pudo cancelar la suscripción. Intentá más tarde." : "Could not cancel subscription. Please try again later.",
        variant: "destructive"
      });
    } finally {
      setLoadingAction(null);
    }
  };

  const handleUpdatePlan = async (actionId: string, newPlan: string) => {
    if (!labelSlug) return;
    setLoadingAction(actionId);
    try {
      await updateSubscription(labelSlug, newPlan);
      
      const PLAN_LEVELS: Record<string, number> = { free: 0, indie: 1, pro: 2 };
      const currentLevel = PLAN_LEVELS[plan.toLowerCase()] || 0;
      const newLevel = PLAN_LEVELS[newPlan.toLowerCase()] || 0;
      const isDowngrade = newLevel < currentLevel;

      if (isDowngrade) {
        // For downgrades, Polar defers the change until the end of the billing period.
        // We keep the current plan on the UI and show a clarifying toast.
        addToast({
          title: lang === "es" ? "Cambio de plan programado" : "Plan downgrade scheduled",
          description: lang === "es" 
            ? `Tu plan cambiará a ${newPlan.toUpperCase()} al finalizar tu período de facturación actual. Mientras tanto, conservás tus beneficios ${plan.toUpperCase()}.` 
            : `Your plan will update to ${newPlan.toUpperCase()} at the end of your current billing cycle. You will keep your ${plan.toUpperCase()} benefits until then.`,
        });
      } else {
        // For upgrades, we update the plan immediately.
        setPlan(newPlan);
        localStorage.setItem("plan", newPlan);
        window.dispatchEvent(new Event("plan_updated"));
        addToast({
          title: lang === "es" ? "Éxito" : "Success",
          description: lang === "es" 
            ? `Plan actualizado a ${newPlan.toUpperCase()} correctamente.` 
            : `Plan updated to ${newPlan.toUpperCase()} successfully.`,
        });
      }
      fetchBilling(labelSlug);
    } catch (err) {
      addToast({
        title: "Error",
        description: lang === "es" ? "No se pudo actualizar el plan. Intentá más tarde." : "Could not update plan. Please try again later.",
        variant: "destructive"
      });
    } finally {
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
    
    // Add metadata with slug so backend updates the correct account
    url.searchParams.append("metadata[slug]", labelSlug);
    
    // Redirect to dedicated success page after checkout with the Polar template variable
    const origin = window.location.origin;
    url.searchParams.append("success_url", `${origin}/success?checkout_id={CHECKOUT_ID}`);
    
    // Signal to dashboard/success page that a payment is in progress
    localStorage.setItem("payment_completed", "true");
    
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
            {plan === "pro" ? t("settings.plan_pro") : plan === "indie" ? (lang === "es" ? "Plan Indie" : "Indie Plan") : t("settings.plan_free")}
          </span>
          {billing?.next_billing_date && subscriptionStatus !== "frozen" && (
            <span className="text-xs text-muted">
              {billing.status === "canceled" ? t("settings.plan_ends") : t("settings.plan_renew")}{" "}
              {new Date(billing.next_billing_date).toLocaleDateString()}
              {billing.status !== "canceled" && billing.amount && (
                lang === "es" ? ` por $${(billing.amount / 100).toFixed(0)}` : ` for $${(billing.amount / 100).toFixed(0)}`
              )}
            </span>
          )}
          {subscriptionStatus === "frozen" && (
            <span className="text-xs text-red-500 font-medium ml-2 border border-red-500/20 bg-red-500/10 px-2 py-0.5 rounded">
              {lang === "es" ? "Cuenta Congelada" : "Frozen Account"}
            </span>
          )}
        </div>

        {subscriptionStatus === "frozen" && frozenAt && (
          <div className="mb-4 p-3 border border-red-500/30 bg-red-500/5 rounded">
            <p className="text-sm text-red-500 mb-1 font-medium">
              {lang === "es" ? "Eliminación programada en: " : "Scheduled deletion in: "}
              {Math.max(0, 30 - Math.floor((Date.now() - new Date(frozenAt).getTime()) / (1000 * 60 * 60 * 24)))} {lang === "es" ? "días" : "days"}
            </p>
            <p className="text-xs text-red-500/80">
              {lang === "es" 
                ? "Renová tu plan para evitar la pérdida permanente de todos tus MP3s y el historial de demos de tu cuenta." 
                : "Renew your plan to avoid permanent loss of all your MP3s and demo history."}
            </p>
          </div>
        )}

        {plan === "free" && subscriptionStatus !== "frozen" && (
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
                { feature: t("settings.feature.tracks"), free: lang === "es" ? "10/mes" : "10/mo", indie: lang === "es" ? "100/mes" : "100/mo", pro: lang === "es" ? "500/mes" : "500/mo" },
                { feature: t("settings.feature.storage"), free: "0", indie: lang === "es" ? "7 días" : "7 days", pro: lang === "es" ? "14 días" : "14 days" },
                { feature: t("settings.feature.emails"), free: "✕", indie: lang === "es" ? "100/mes" : "100/mo", pro: lang === "es" ? "500/mes" : "500/mo" },
                { feature: t("settings.feature.link"), free: "✓", indie: "✓", pro: "✓" },
                { feature: t("settings.feature.support"), free: "Email", indie: "WhatsApp", pro: "WhatsApp" },
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
                  {plan === "free" ? (lang === "es" ? "Actual" : "Current") : (lang === "es" ? "Gratis" : "Free")}
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
                      {lang === "es" ? "Suscribirse — $25/mes" : "Subscribe — $25/mo"}
                    </a>
                  ) : plan === "indie" ? (
                    subscriptionStatus === "frozen" ? (
                      <a
                        href={getCheckoutUrl(POLAR_CHECKOUT_INDIE)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block px-4 py-2 rounded text-xs font-medium transition-all hover:opacity-90"
                        style={{ background: "#10b981", color: "#09090b" }}
                      >
                        {lang === "es" ? "Renovar plan — $25/mes" : "Renew plan — $25/mo"}
                      </a>
                    ) : (
                      <button
                        onClick={() => handleCancel("cancel_indie")}
                        disabled={!!loadingAction}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded text-xs font-medium transition-all border border-red-500/30 text-red-500 hover:bg-red-500/5 disabled:opacity-50 min-w-[140px]"
                      >
                        {loadingAction === "cancel_indie" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          lang === "es" ? "Cancelar suscripción" : "Cancel subscription"
                        )}
                      </button>
                    )
                  ) : (
                    <button
                      onClick={() => handleUpdatePlan("downgrade_indie", "indie")}
                      disabled={!!loadingAction}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded text-xs font-medium transition-all border border-[#10b981]/30 text-[#10b981] hover:bg-[#10b981]/5 disabled:opacity-50 min-w-[140px]"
                    >
                      {loadingAction === "downgrade_indie" ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        lang === "es" ? "Bajar plan — $25/mes" : "Downgrade — $25/mo"
                      )}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {plan === "pro" ? (
                    subscriptionStatus === "frozen" ? (
                      <a
                        href={getCheckoutUrl(POLAR_CHECKOUT_PRO)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block px-4 py-2 rounded text-xs font-medium transition-all hover:opacity-90"
                        style={{ background: "#10b981", color: "#09090b" }}
                      >
                        {lang === "es" ? "Renovar plan — $49/mes" : "Renew plan — $49/mo"}
                      </a>
                    ) : (
                      <button
                        onClick={() => handleCancel("cancel_pro")}
                        disabled={!!loadingAction}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded text-xs font-medium transition-all border border-red-500/30 text-red-500 hover:bg-red-500/5 disabled:opacity-50 min-w-[140px]"
                      >
                        {loadingAction === "cancel_pro" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          lang === "es" ? "Cancelar suscripción" : "Cancel subscription"
                        )}
                      </button>
                    )
                  ) : (
                    <button
                      onClick={(e) => {
                        if (plan === "indie") {
                          handleUpdatePlan("upgrade_pro", "pro");
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
                      ) : plan === "indie" ? (
                        lang === "es" ? "Subir plan — $49/mes" : "Upgrade — $49/mo"
                      ) : (
                        lang === "es" ? "Suscribirse — $49/mes" : "Subscribe — $49/mo"
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
