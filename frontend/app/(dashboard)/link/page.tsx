"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n";

type LabelStats = { total: number; pending: number; approved: number; rejected: number };
type LabelInfo = { id: string; name: string; slug: string; owner_email: string; sonic_signature: string; created_at: string; submission_title?: string; submission_description?: string; plan?: string };

const LEMON_SQUEEZY_URL = "https://truepeak.lemonsqueezy.com/checkout/buy/xxx";

export default function LinkPage() {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [labelName, setLabelName] = useState<string>("");
  const [labelId, setLabelId] = useState<string>("");
  const [stats, setStats] = useState<LabelStats | null>(null);
  const [plan, setPlan] = useState<string>("free");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editTitle, setEditTitle] = useState("Enviar demo");
  const [editDescription, setEditDescription] = useState("Subí tu WAV. Analizamos BPM, LUFS, fase y headroom antes de que el sello lo escuche.");
  const [savingTexts, setSavingTexts] = useState(false);
  const [textsSaved, setTextsSaved] = useState(false);
  const [textsError, setTextsError] = useState<string | null>(null);

  useEffect(() => {
    const storedSlug = localStorage.getItem("slug");
    if (!storedSlug) {
      setLoading(false);
      setError("no-slug");
      return;
    }
    setSlug(storedSlug);

    const fetchLabel = async () => {
      try {
        const res = await fetch(`/api/labels/${storedSlug}`);
        if (!res.ok) throw new Error("Failed to fetch label");
        const data: LabelInfo = await res.json();
        setLabelName(data.name);
        setLabelId(data.id);
        if (data.plan) {
          setPlan(data.plan);
          localStorage.setItem("plan", data.plan);
        }
        if (data.submission_title) setEditTitle(data.submission_title);
        if (data.submission_description) setEditDescription(data.submission_description);
      } catch {
        setLabelName(storedSlug);
      }
    };

    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/labels/${storedSlug}/stats`, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to fetch stats");
        const data: LabelStats = await res.json();
        setStats(data);
      } catch {
        setStats({ total: 0, pending: 0, approved: 0, rejected: 0 });
      }
    };

    Promise.all([fetchLabel(), fetchStats()]).finally(() => setLoading(false));
  }, []);

  const submissionUrl = slug ? `${typeof window !== "undefined" ? window.location.origin : ""}/s/${slug}` : "";

  const handleCopy = async () => {
    if (!submissionUrl) return;
    await navigator.clipboard.writeText(submissionUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveTexts = async () => {
    setSavingTexts(true);
    setTextsSaved(false);
    setTextsError(null);
    try {
      const res = await fetch(`/api/labels/${slug}/submission-text`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle, description: editDescription }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || t("link.edit.save_error"));
      }
      setTextsSaved(true);
      setTimeout(() => setTextsSaved(false), 3000);
    } catch (e: any) {
      setTextsError(e.message);
    } finally {
      setSavingTexts(false);
    }
  };

  if (error === "no-slug") {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="font-display font-semibold text-2xl mb-4">{t("link.error.title")}</h1>
        <p className="text-sm text-muted">{t("link.error.no_slug")}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">{t("link.section_label")}</div>
        <h1 className="font-display font-semibold text-2xl mb-6">{t("link.loading")}</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-12 rounded" style={{ background: "var(--bg-card)" }} />
          <div className="h-40 rounded" style={{ background: "var(--bg-card)" }} />
          <div className="grid grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded" style={{ background: "var(--bg-card)" }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const displayStats = stats ?? { total: 0, pending: 0, approved: 0, rejected: 0 };
  const isAtFreeLimit = plan === "free" && displayStats.total >= 5;

  if (isAtFreeLimit) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">{t("link.section_label")}</div>
        <h1 className="font-display font-semibold text-2xl mb-6">{t("link.title")}</h1>

        <div className="rounded border p-6 mb-8" style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)" }}>
          <div className="flex items-start gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" className="mt-0.5 flex-shrink-0">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <p className="text-sm font-medium mb-1" style={{ color: "#ef4444" }}>{t("link.limit.title")}</p>
              <p className="text-sm text-muted mb-4">{t("link.limit.desc")}</p>
              <a href={LEMON_SQUEEZY_URL} target="_blank" rel="noopener noreferrer" className="inline-block px-5 py-2.5 rounded text-sm font-medium transition-all hover:opacity-90" style={{ background: "#10b981", color: "#09090b" }}>
                {t("link.limit.cta")}
              </a>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {[
            { label: t("link.stats.total"), value: String(displayStats.total) },
            { label: t("link.stats.pending"), value: String(displayStats.pending) },
            { label: t("link.stats.approved"), value: String(displayStats.approved) },
            { label: t("link.stats.rejected"), value: String(displayStats.rejected) },
          ].map((stat) => (
            <div key={stat.label} className="rounded border p-4 text-center" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
              <div className="font-mono text-2xl font-bold">{stat.value}</div>
              <div className="text-xs text-muted mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">{t("link.section_label")}</div>
      <h1 className="font-display font-semibold text-2xl mb-6">{t("link.title")}</h1>

      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 px-4 py-3 rounded border font-mono text-sm" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
          {submissionUrl}
        </div>
        <button onClick={handleCopy} className="px-4 py-3 rounded text-sm font-medium transition-all hover:opacity-90" style={{ background: "#10b981", color: "#09090b" }}>
          {copied ? t("link.copied") : t("link.copy")}
        </button>
      </div>

      <p className="text-sm text-muted mb-8">{t("link.description")}</p>

      {/* Preview */}
      <div className="rounded border p-6" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
        <div className="text-xs font-mono text-muted mb-4">{t("link.preview_label")}</div>
        <div className="rounded border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded" style={{ background: "#10b981" }} />
            <span className="font-display font-semibold text-sm">{labelName || slug}</span>
          </div>
          <p className="text-sm text-muted mb-4">{editDescription}</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-10 rounded border flex items-center px-3" style={{ borderColor: "var(--border)" }}>
              <span className="text-sm text-muted">{t("link.preview_placeholder")}</span>
            </div>
            <button className="px-5 h-10 rounded text-sm font-medium" style={{ background: "#10b981", color: "#09090b" }}>
              {t("link.preview_submit")}
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-8 grid grid-cols-4 gap-4">
        {[
          { label: t("link.stats.total"), value: String(displayStats.total) },
          { label: t("link.stats.pending"), value: String(displayStats.pending) },
          { label: t("link.stats.approved"), value: String(displayStats.approved) },
          { label: t("link.stats.rejected"), value: String(displayStats.rejected) },
        ].map((stat) => (
          <div key={stat.label} className="rounded border p-4 text-center" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <div className="font-mono text-2xl font-bold">{stat.value}</div>
            <div className="text-xs text-muted mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Editable submission texts */}
      <div className="mt-8 rounded border p-6" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
        <div className="text-xs font-mono text-muted mb-4">{t("link.edit.section")}</div>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t("link.edit.title_label")}</label>
            <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="w-full px-3 py-2.5 rounded border text-sm bg-transparent" style={{ borderColor: "var(--border)" }} placeholder="Enviar demo" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t("link.edit.desc_label")}</label>
            <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="w-full px-3 py-2.5 rounded border text-sm bg-transparent" style={{ borderColor: "var(--border)" }} placeholder="Subí tu WAV. Analizamos BPM, LUFS, fase y headroom..." rows={3} suppressHydrationWarning />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleSaveTexts} disabled={savingTexts} className="px-4 py-2 rounded text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50" style={{ background: "#10b981", color: "#09090b" }}>
              {savingTexts ? t("link.edit.saving") : t("link.edit.save")}
            </button>
            {textsSaved && <span className="text-xs" style={{ color: "#10b981" }}>{t("link.edit.saved")}</span>}
            {textsError && <span className="text-xs" style={{ color: "#ef4444" }}>{textsError}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
