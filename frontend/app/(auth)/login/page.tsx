"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await fetch(`/api/labels/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ identifier, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: t("login.error") }));
        throw new Error(data.detail || t("login.error"));
      }
      const data = await res.json();
      localStorage.setItem("slug", data.slug);
      localStorage.setItem("label_id", data.id);
      localStorage.setItem("plan", data.plan || "free");
      if (data.token) localStorage.setItem("token", data.token);
      router.push("/inbox");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.error"));
    } finally { setLoading(false); }
  };

  return (
    <div className="rounded border p-8" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-white transition-colors mb-4">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5" /><polyline points="12 19 5 12 12 5" /></svg>
        {t("login.back")}
      </Link>
      <h1 className="font-display font-semibold text-xl mb-2">{t("login.title")}</h1>
      <p className="text-sm text-muted mb-6">{t("login.subtitle")}</p>
      {error && <div className="mb-4 px-4 py-3 rounded text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}>{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t("login.email_label")}</label>
          <input type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="w-full px-3 py-2.5 rounded border text-sm bg-transparent" style={{ borderColor: "var(--border)" }} placeholder={t("login.email_placeholder")} required />
        </div>
        <div>
          <label className="text-sm font-medium mb-1.5 block">{t("login.password_label")}</label>
          <div className="relative">
            <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2.5 pr-10 rounded border text-sm bg-transparent" style={{ borderColor: "var(--border)" }} placeholder={t("login.password_placeholder")} required minLength={8} />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white transition-colors cursor-pointer" tabIndex={-1}>
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
              )}
            </button>
          </div>
        </div>
        <button type="submit" disabled={loading} className="w-full py-2.5 text-sm font-medium rounded transition-all hover:opacity-90 disabled:opacity-50 cursor-pointer" style={{ background: "#10b981", color: "#09090b" }}>{loading ? t("login.submitting") : t("login.submit")}</button>
      </form>
    </div>
  );
}
