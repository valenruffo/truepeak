"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n";

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [role, setRole] = useState<"label" | "dj">("label");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError("");
    if (password.length < 8) { setError(t("register.error_length")); return; }
    if (password !== confirmPassword) { setError(t("register.error_match")); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/labels/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, slug: slug.toLowerCase().replace(/\s+/g, "-"), owner_email: email, password, role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: t("register.error_create") }));
        throw new Error(data.detail || t("register.error_create"));
      }
      const data = await res.json();
      localStorage.setItem("slug", data.slug);
      localStorage.setItem("label_id", data.id);
      localStorage.setItem("plan", data.plan || "free");
      localStorage.setItem("role", data.role || "label");
      if (data.token) localStorage.setItem("token", data.token);
      router.push("/inbox");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("register.error_create"));
    } finally { setLoading(false); }
  };

  return (
    <div className="rounded border p-8" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-white transition-colors mb-4">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5" /><polyline points="12 19 5 12 12 5" /></svg>
        {t("register.back")}
      </Link>
      <h1 className="font-display font-semibold text-xl mb-2">{t("register.title")}</h1>
      <p className="text-sm text-muted mb-6">{t("register.subtitle")}</p>
      {error && <div className="mb-4 px-4 py-3 rounded text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}>{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t("register.name_label")}</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2.5 rounded border text-sm bg-transparent" style={{ borderColor: "var(--border)" }} placeholder={t("register.name_placeholder")} required />
        </div>
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t("register.slug_label")}</label>
          <input type="text" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} className="w-full px-3 py-2.5 rounded border text-sm bg-transparent" style={{ borderColor: "var(--border)" }} placeholder={t("register.slug_placeholder")} required />
          <p className="text-xs text-muted mt-1">{typeof window !== "undefined" ? window.location.origin : ""}/s/{slug || "tu-sello"}</p>
        </div>

        {/* Role selector */}
        <div>
          <label className="text-sm font-medium mb-2 block">{t("register.role_label")}</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setRole("label")}
              className="p-4 rounded border text-left transition-all"
              style={{
                borderColor: role === "label" ? "#10b981" : "var(--border)",
                background: role === "label" ? "rgba(16,185,129,0.08)" : "transparent",
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={role === "label" ? "#10b981" : "var(--text-muted)"} strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 12h8M12 8v8" />
                </svg>
                <span className="text-sm font-medium">{t("register.role_sello")}</span>
              </div>
              <p className="text-xs text-muted">{t("register.role_sello_desc")}</p>
            </button>
            <button
              type="button"
              onClick={() => setRole("dj")}
              className="p-4 rounded border text-left transition-all"
              style={{
                borderColor: role === "dj" ? "#06b6d4" : "var(--border)",
                background: role === "dj" ? "rgba(6,182,212,0.08)" : "transparent",
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={role === "dj" ? "#06b6d4" : "var(--text-muted)"} strokeWidth="1.5">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
                <span className="text-sm font-medium">{t("register.role_dj")}</span>
              </div>
              <p className="text-xs text-muted">{t("register.role_dj_desc")}</p>
            </button>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium mb-1.5 block">{t("register.email_label")}</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2.5 rounded border text-sm bg-transparent" style={{ borderColor: "var(--border)" }} placeholder={t("register.email_placeholder")} required />
        </div>
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t("register.password_label")}</label>
          <div className="relative">
            <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2.5 pr-10 rounded border text-sm bg-transparent" style={{ borderColor: "var(--border)" }} placeholder={t("register.password_placeholder")} required minLength={8} />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white transition-colors cursor-pointer" tabIndex={-1}>
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
              )}
            </button>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t("register.confirm_label")}</label>
          <div className="relative">
            <input type={showConfirm ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full px-3 py-2.5 pr-10 rounded border text-sm bg-transparent" style={{ borderColor: "var(--border)" }} placeholder={t("register.confirm_placeholder")} required minLength={8} />
            <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white transition-colors cursor-pointer" tabIndex={-1}>
              {showConfirm ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
              )}
            </button>
          </div>
        </div>
        <button type="submit" disabled={loading} className="w-full py-2.5 text-sm font-medium rounded transition-all hover:opacity-90 disabled:opacity-50 cursor-pointer" style={{ background: "#10b981", color: "#09090b" }}>{loading ? t("register.submitting") : t("register.submit")}</button>
      </form>
    </div>
  );
}
