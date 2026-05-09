"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n";

type LabelStats = { 
  total: number; 
  inbox: number; 
  shortlist: number; 
  rejected: number; 
  auto_rejected: number;
  max_tracks_month: number;
  emails_sent_this_month: number;
};
type LabelInfo = { id: string; name: string; slug: string; owner_email: string; sonic_signature: string; created_at: string; submission_title?: string; submission_description?: string; plan?: string; max_tracks_month?: number };

export default function LinkPage() {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [labelName, setLabelName] = useState<string>("");
  const [labelId, setLabelId] = useState<string>("");
  const [stats, setStats] = useState<LabelStats | null>(null);
  const [plan, setPlan] = useState<string>("free");
  const [maxTracks, setMaxTracks] = useState<number>(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editTitle, setEditTitle] = useState("Enviar demo");
  const [editDescription, setEditDescription] = useState("Subí tu WAV. Analizamos BPM, LUFS, fase y headroom antes de que el sello lo escuche.");
  const [savingTexts, setSavingTexts] = useState(false);
  const [textsSaved, setTextsSaved] = useState(false);
  const [textsError, setTextsError] = useState<string | null>(null);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoSaved, setLogoSaved] = useState(false);
  const [logoDragActive, setLogoDragActive] = useState(false);

  const API = "";
  const getAuthHeaders = () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    return token ? { "Authorization": `Bearer ${token}` } : {};
  };

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
        if (data.max_tracks_month) setMaxTracks(data.max_tracks_month);
        if (data.submission_title) setEditTitle(data.submission_title);
        if (data.submission_description) setEditDescription(data.submission_description);
        if (data.logo_path) setLogoUrl(`/logos/${data.logo_path}`);
      } catch {
        setLabelName(storedSlug);
      }
    };

    const fetchStats = async () => {
      try {
        const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`/api/labels/${storedSlug}/stats`, { credentials: "include", headers });
        if (!res.ok) throw new Error("Failed to fetch stats");
        const data: LabelStats = await res.json();
        setStats(data);
        if (data.max_tracks_month) setMaxTracks(data.max_tracks_month);
      } catch {
        setStats({ total: 0, inbox: 0, shortlist: 0, rejected: 0, auto_rejected: 0 });
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

  const handleLogoFile = (f: File) => {
    const validExts = [".jpg", ".jpeg", ".png", ".webp"];
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    if (!validExts.includes(ext)) { setLogoError(t("config.logo_error_ext")); return; }
    if (f.size > 5 * 1024 * 1024) { setLogoError(t("config.logo_error_size")); return; }
    setLogoError(null); setLogoFile(f);
    const reader = new FileReader();
    reader.onload = (e) => setLogoPreview(e.target?.result as string);
    reader.readAsDataURL(f);
  };

  const handleLogoDrop = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setLogoDragActive(false); if (e.dataTransfer.files[0]) handleLogoFile(e.dataTransfer.files[0]); };
  const handleLogoDrag = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (e.type === "dragenter" || e.type === "dragover") setLogoDragActive(true); else if (e.type === "dragleave") setLogoDragActive(false); };

  const uploadLogo = async () => {
    if (!logoFile || !slug) return;
    setLogoUploading(true); setLogoError(null);
    try {
      const formData = new FormData();
      formData.append("file", logoFile);
      const res = await fetch(`/api/labels/${slug}/logo`, { method: "POST", headers: getAuthHeaders(), body: formData });
      if (!res.ok) { const err = await res.json().catch(() => ({ detail: t("inbox.error_unknown") })); throw new Error(err.detail || `Error ${res.status}`); }
      const data = await res.json();
      setLogoUrl(data.logo_url); setLogoSaved(true); setLogoFile(null); setLogoPreview(null);
      setTimeout(() => setLogoSaved(false), 2000);
    } catch (e) { setLogoError(e instanceof Error ? e.message : t("inbox.error_unknown")); }
    finally { setLogoUploading(false); }
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

  const displayStats = stats ?? { total: 0, inbox: 0, shortlist: 0, rejected: 0, auto_rejected: 0 };
  const isAtFreeLimit = plan === "free" && displayStats.total >= maxTracks;

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
              <p className="text-sm font-medium mb-1" style={{ color: "#ef4444" }}>
                {t("link.limit.title")} — {displayStats.total}/{maxTracks} tracks
              </p>
              <p className="text-sm text-muted mb-4">{t("link.limit.desc")}</p>
              <Link href="/settings" className="inline-block px-5 py-2.5 rounded text-sm font-medium transition-all hover:opacity-90" style={{ background: "#10b981", color: "#09090b" }}>
                Ver planes disponibles
              </Link>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {[
            { label: t("link.stats.total"), value: String(displayStats.total) },
            { label: t("link.stats.pending"), value: String(displayStats.inbox) },
            { label: t("link.stats.approved"), value: String(displayStats.shortlist) },
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
          { label: t("link.stats.pending"), value: String(displayStats.inbox) },
          { label: t("link.stats.approved"), value: String(displayStats.shortlist) },
          { label: t("link.stats.rejected"), value: String(displayStats.rejected) },
        ].map((stat) => (
          <div key={stat.label} className="rounded border p-4 text-center" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <div className="font-mono text-2xl font-bold">{stat.value}</div>
            <div className="text-xs text-muted mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Editable submission texts */}
      <div className="mt-8 rounded-lg border p-6" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
        <div className="text-xs font-mono text-muted mb-4">{t("link.edit.section")}</div>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t("link.edit.title_label")}</label>
            <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="w-full px-3 py-2.5 rounded-lg border text-sm bg-transparent" style={{ borderColor: "var(--border)" }} placeholder="Enviar demo" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t("link.edit.desc_label")}</label>
            <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="w-full px-3 py-2.5 rounded-lg border text-sm bg-transparent" style={{ borderColor: "var(--border)" }} placeholder="Subí tu WAV. Analizamos BPM, LUFS, fase y headroom..." rows={3} suppressHydrationWarning />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleSaveTexts} disabled={savingTexts} className="px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50" style={{ background: "#10b981", color: "#09090b" }}>
              {savingTexts ? t("link.edit.saving") : t("link.edit.save")}
            </button>
            {textsSaved && <span className="text-xs" style={{ color: "#10b981" }}>{t("link.edit.saved")}</span>}
            {textsError && <span className="text-xs" style={{ color: "#ef4444" }}>{textsError}</span>}
          </div>
        </div>
      </div>

      {/* Logo Upload Section */}
      <div className="mt-8 rounded-lg border p-6 bg-card" style={{ borderColor: "var(--border)" }}>
        <label className="text-sm font-medium mb-3 block">{t("config.logo_label")}</label>
        <div className="flex items-center gap-4">
          {(logoPreview || logoUrl) && (
            <div className="relative group">
              <img src={logoPreview || logoUrl || ""} alt="Logo" className="w-20 h-20 rounded-lg object-cover border bg-secondary" style={{ borderColor: "var(--border)" }} />
              {logoPreview && <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg"><span className="text-[10px] font-bold text-white uppercase tracking-wider">Preview</span></div>}
            </div>
          )}
          <div className="flex-1 space-y-2">
            <div 
              onDragEnter={handleLogoDrag} onDragLeave={handleLogoDrag} onDragOver={handleLogoDrag} onDrop={handleLogoDrop} 
              className="rounded-lg border border-dashed p-4 text-center cursor-pointer transition-all hover:bg-secondary/50 group" 
              style={{ borderColor: logoDragActive ? "#10b981" : "var(--border)", background: logoDragActive ? "rgba(16,185,129,0.05)" : "transparent" }} 
              onClick={() => document.getElementById("logo-input")?.click()}
            >
              <input id="logo-input" type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" onChange={(e) => e.target.files?.[0] && handleLogoFile(e.target.files[0])} />
              <div className="flex flex-col items-center gap-1">
                <svg className={cn("w-5 h-5 mb-1 transition-colors", logoDragActive ? "text-emerald-500" : "text-muted-foreground group-hover:text-foreground")} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                <span className="text-xs text-muted-foreground font-medium">
                  {logoPreview ? `${logoFile?.name}` : logoUrl ? t("config.logo_change") : t("config.logo_upload_hint")}
                </span>
                <span className="text-[10px] text-muted-foreground/60 tracking-tight">JPG, PNG or WebP • Max 5MB</span>
              </div>
            </div>
            {logoFile && (
              <button 
                onClick={uploadLogo} 
                disabled={logoUploading} 
                className="w-full py-2.5 text-xs font-bold rounded-lg transition-all hover:brightness-110 disabled:opacity-50 shadow-sm shadow-emerald-500/10" 
                style={{ background: "#10b981", color: "#09090b" }}
              >
                {logoUploading ? t("config.logo_uploading") : t("config.logo_save")}
              </button>
            )}
            {logoError && <p className="text-[10px] font-medium text-destructive mt-1">{logoError}</p>}
            {logoSaved && <p className="text-[10px] font-bold text-emerald-500 mt-1 flex items-center gap-1"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> {t("config.logo_saved")}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
