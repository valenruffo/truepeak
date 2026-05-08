"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const LEMON_SQUEEZY_URL = "https://truepeak.lemonsqueezy.com/checkout/buy/xxx";

export default function SettingsPage() {
  const router = useRouter();
  const [plan, setPlan] = useState<string>("free");
  const [labelName, setLabelName] = useState<string>("");
  const [lang, setLang] = useState<string>("es");
  const [theme, setTheme] = useState<string>("dark");
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [logoutLoading, setLogoutLoading] = useState(false);

  useEffect(() => {
    const storedPlan = localStorage.getItem("plan") || "free";
    const storedLang = localStorage.getItem("lang") || "es";
    const storedTheme = localStorage.getItem("theme") || "dark";
    setPlan(storedPlan);
    setLang(storedLang);
    setTheme(storedTheme);

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

  const handleLangToggle = () => {
    const next = lang === "es" ? "en" : "es";
    setLang(next);
    localStorage.setItem("lang", next);
  };

  const handleThemeToggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    document.body.className = next === "light" ? "light" : "";
  };

  const handleCancelSubscription = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      // TODO: wire up actual cancel endpoint
      // const res = await fetch("/api/billing/cancel", { method: "POST", credentials: "include" });
      // if (!res.ok) throw new Error("Error al cancelar");
      setPlan("free");
      localStorage.setItem("plan", "free");
      setShowCancelModal(false);
    } catch (e: any) {
      setCancelError(e.message || "Error al cancelar la suscripción");
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
    localStorage.removeItem("lang");
    localStorage.removeItem("theme");
    fetch(`/api/labels/logout`, { method: "POST", credentials: "include" })
      .catch(() => {})
      .finally(() => {
        router.push("/");
      });
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Configuración</div>
      <h1 className="font-display font-semibold text-2xl mb-8">Ajustes</h1>

      {/* Plan Section */}
      <div className="rounded border p-6 mb-6" style={{ borderColor: "#27272a", background: "#111114" }}>
        <div className="text-xs font-mono uppercase tracking-wider text-muted mb-4">Plan actual</div>

        <div className="flex items-center gap-3 mb-4">
          <span
            className="px-2.5 py-1 rounded text-xs font-semibold uppercase tracking-wider"
            style={{
              background: plan === "pro" ? "rgba(16,185,129,0.12)" : "rgba(161,161,170,0.1)",
              color: plan === "pro" ? "#10b981" : "#a1a1aa",
            }}
          >
            {plan === "pro" ? "Plan Pro" : "Plan Gratuito"}
          </span>
          {plan === "pro" && (
            <span className="text-xs text-muted">Se renueva el 1 de cada mes</span>
          )}
        </div>

        {plan === "free" && (
          <div className="mb-4">
            <p className="text-sm text-muted mb-3">
              Estás en el plan gratuito. Hacé upgrade a Pro para desbloquear todas las funciones.
            </p>
            <a
              href={LEMON_SQUEEZY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-5 py-2.5 rounded text-sm font-medium transition-all hover:opacity-90"
              style={{ background: "#10b981", color: "#09090b" }}
            >
              Upgrade a Pro
            </a>
          </div>
        )}

        {plan === "pro" && (
          <div className="mb-4">
            <button
              onClick={() => setShowCancelModal(true)}
              className="px-5 py-2.5 rounded text-sm font-medium border transition-all hover:opacity-80"
              style={{ borderColor: "#27272a", color: "#a1a1aa", background: "transparent" }}
            >
              Cancelar suscripción
            </button>
          </div>
        )}

        {/* Features comparison */}
        <div className="rounded border overflow-hidden" style={{ borderColor: "#27272a" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#0c0c0e" }}>
                <th className="text-left px-4 py-3 font-mono text-xs uppercase tracking-wider text-muted">Feature</th>
                <th className="text-center px-4 py-3 font-mono text-xs uppercase tracking-wider text-muted">Free</th>
                <th className="text-center px-4 py-3 font-mono text-xs uppercase tracking-wider" style={{ color: "#10b981" }}>Pro</th>
              </tr>
            </thead>
            <tbody>
              {[
                { feature: "Tracks", free: "5", pro: "Ilimitados" },
                { feature: "Almacenamiento HQ", free: "10", pro: "100" },
                { feature: "Emails / CRM", free: "✕", pro: "✓" },
                { feature: "Link personalizado", free: "✓", pro: "✓" },
                { feature: "Soporte", free: "Email", pro: "WhatsApp" },
              ].map((row, i) => (
                <tr key={row.feature} style={{ borderTop: "1px solid #27272a" }}>
                  <td className="px-4 py-3">{row.feature}</td>
                  <td className="px-4 py-3 text-center text-muted">{row.free}</td>
                  <td className="px-4 py-3 text-center" style={{ color: "#10b981" }}>{row.pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Appearance Section */}
      <div className="rounded border p-6 mb-6" style={{ borderColor: "#27272a", background: "#111114" }}>
        <div className="text-xs font-mono uppercase tracking-wider text-muted mb-4">Apariencia</div>

        <div className="space-y-5">
          {/* Language */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Idioma</div>
              <div className="text-xs text-muted">Español / English</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-1 rounded ${lang === "es" ? "font-semibold" : "text-muted"}`} style={lang === "es" ? { color: "#10b981" } : {}}>
                Español
              </span>
              <button
                onClick={handleLangToggle}
                className="relative w-11 h-6 rounded-full transition-colors"
                style={{ background: lang === "en" ? "#10b981" : "#27272a" }}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform"
                  style={{ background: "#fafafa", transform: lang === "en" ? "translateX(20px)" : "translateX(0)" }}
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
              <div className="text-sm font-medium">Tema</div>
              <div className="text-xs text-muted">Modo oscuro / claro</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-1 rounded ${theme === "dark" ? "font-semibold" : "text-muted"}`} style={theme === "dark" ? { color: "#10b981" } : {}}>
                Dark
              </span>
              <button
                onClick={handleThemeToggle}
                className="relative w-11 h-6 rounded-full transition-colors"
                style={{ background: theme === "light" ? "#10b981" : "#27272a" }}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform"
                  style={{ background: "#fafafa", transform: theme === "light" ? "translateX(20px)" : "translateX(0)" }}
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
      <div className="rounded border p-6" style={{ borderColor: "#27272a", background: "#111114" }}>
        <div className="text-xs font-mono uppercase tracking-wider text-muted mb-4">Sesión</div>
        <button
          onClick={handleLogout}
          disabled={logoutLoading}
          className="px-5 py-2.5 rounded text-sm font-medium border transition-all hover:opacity-80 disabled:opacity-50"
          style={{ borderColor: "rgba(239,68,68,0.3)", color: "#ef4444", background: "transparent" }}
        >
          {logoutLoading ? "Cerrando sesión..." : "Cerrar sesión"}
        </button>
      </div>

      {/* Cancel confirmation modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" style={{ background: "rgba(0,0,0,0.7)" }}>
          <div
            className="w-full max-w-md rounded border p-6"
            style={{ borderColor: "#27272a", background: "#111114" }}
          >
            <div className="flex items-center gap-3 mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#facc15" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <h2 className="text-lg font-semibold">¿Cancelar suscripción?</h2>
            </div>
            <p className="text-sm text-muted mb-6">
              Si cancelás, perdés acceso a tracks ilimitados, almacenamiento HQ extendido y soporte por WhatsApp.
              Volvés al plan gratuito de 5 tracks.
            </p>
            {cancelError && (
              <div className="mb-4 px-4 py-3 rounded text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}>
                {cancelError}
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowCancelModal(false); setCancelError(null); }}
                className="px-5 py-2.5 rounded text-sm font-medium border transition-all hover:opacity-80"
                style={{ borderColor: "#27272a", color: "#a1a1aa", background: "transparent" }}
              >
                No, mantener Pro
              </button>
              <button
                onClick={handleCancelSubscription}
                disabled={cancelling}
                className="px-5 py-2.5 rounded text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: "#ef4444", color: "#fafafa" }}
              >
                {cancelling ? "Cancelando..." : "Sí, cancelar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
