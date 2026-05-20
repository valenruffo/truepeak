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
type LabelInfo = { id: string; name: string; slug: string; owner_email: string; sonic_signature: string; created_at: string; submission_title?: string; submission_description?: string; plan?: string; max_tracks_month?: number; logo_path?: string | null; ask_instagram?: boolean; ask_soundcloud?: boolean };

export default function LinkPage() {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [labelName, setLabelName] = useState<string>("");
  const [labelId, setLabelId] = useState<string>("");
  const [stats, setStats] = useState<LabelStats | null>(null);
  const [plan, setPlan] = useState<string>("free");
  const [maxTracks, setMaxTracks] = useState<number>(10);
  const [role, setRole] = useState<string>("label");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editTitle, setEditTitle] = useState("Enviar demo");
  const [editDescription, setEditDescription] = useState("Subí tu WAV. Analizamos BPM, LUFS, fase y headroom antes de que el sello lo escuche.");
  const [savingTexts, setSavingTexts] = useState(false);
  const [textsSaved, setTextsSaved] = useState(false);
  const [textsError, setTextsError] = useState<string | null>(null);
  const [askInstagram, setAskInstagram] = useState(false);
  const [askSoundcloud, setAskSoundcloud] = useState(false);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoSaved, setLogoSaved] = useState(false);
  const [logoDragActive, setLogoDragActive] = useState(false);

  const API = "";
  const getAuthHeaders = (): Record<string, string> => {
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
    const storedRole = localStorage.getItem("role");
    if (storedRole === "dj" || storedRole === "label") setRole(storedRole);

    const fetchLabel = async () => {
      try {
        const res = await fetch(`/api/labels/${storedSlug}?t=${Date.now()}`);
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
        setAskInstagram(!!data.ask_instagram);
        setAskSoundcloud(!!data.ask_soundcloud);
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
        setStats({ total: 0, inbox: 0, shortlist: 0, rejected: 0, auto_rejected: 0, max_tracks_month: 0, emails_sent_this_month: 0 });
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

  const handleSaveChanges = async () => {
    setSavingTexts(true);
    setTextsSaved(false);
    setTextsError(null);
    setLogoError(null);
    try {
      if (logoFile) {
        setLogoUploading(true);
        const formData = new FormData();
        formData.append("file", logoFile);
        const res = await fetch(`/api/labels/${slug}/logo`, { method: "POST", headers: getAuthHeaders(), body: formData });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: t("inbox.error_unknown") }));
          throw new Error(err.detail || `Error ${res.status}`);
        }
        const data = await res.json();
        setLogoUrl(data.logo_url);
        setLogoSaved(true);
        setLogoFile(null);
        setLogoPreview(null);
        setTimeout(() => setLogoSaved(false), 2000);
      }

      const resText = await fetch(`/api/labels/${slug}/submission-text`, {
        method: "PUT",
        credentials: "include",
        headers: { 
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify({ 
          title: editTitle, 
          description: editDescription,
          ask_instagram: askInstagram,
          ask_soundcloud: askSoundcloud
        }),
      });
      if (!resText.ok) {
        const err = await resText.json();
        throw new Error(err.detail || t("link.edit.save_error"));
      }

      setTextsSaved(true);
      setTimeout(() => setTextsSaved(false), 3000);
    } catch (e: any) {
      setTextsError(e.message);
    } finally {
      setSavingTexts(false);
      setLogoUploading(false);
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
                {t("link.limit.title")} — {displayStats.total}/{maxTracks} {role === "dj" ? "promos" : "demos"}
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
    <div className="w-full max-w-[1700px] mx-auto px-6 py-12">
      <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">{t("link.section_label")}</div>
      <h1 className="font-display font-semibold text-2xl mb-8">{t("link.title")}</h1>

      {/* Main Grid: Left side config, Right side simulation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Column: Config Panel */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Compartir Link Card */}
          <div className="rounded-lg border p-6" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <h2 className="text-xs font-semibold text-white mb-2 uppercase tracking-wider">Compartir link con productores</h2>
            <p className="text-xs text-muted mb-4">{t("link.description")}</p>
            
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2 rounded border font-mono text-xs overflow-x-auto whitespace-nowrap bg-zinc-950/40" style={{ borderColor: "var(--border)" }}>
                {submissionUrl}
              </div>
              <button onClick={handleCopy} className="px-4 py-2 rounded text-xs font-bold transition-all hover:opacity-90 flex-shrink-0" style={{ background: "#10b981", color: "#09090b" }}>
                {copied ? t("link.copied") : t("link.copy")}
              </button>
            </div>
          </div>

          <div className="rounded-lg border p-6" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <div className="text-xs font-mono text-muted mb-6">{t("link.edit.section")}</div>
            
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              
              {/* Logo Section */}
              <div className="md:col-span-4 flex flex-col items-center text-center space-y-4">
                <label className="text-xs font-semibold text-white block self-start md:self-center">{t("config.logo_label")}</label>
                
                <div className="w-full flex flex-col items-center gap-3">
                  {(logoPreview || logoUrl) ? (
                    <div className="relative group w-32 h-32 rounded-xl overflow-hidden border bg-zinc-900 flex-shrink-0" style={{ borderColor: "var(--border)" }}>
                      <img 
                        src={logoPreview || logoUrl || ""} 
                        alt="Logo Preview" 
                        className="w-full h-full object-cover" 
                      />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 cursor-pointer" onClick={() => document.getElementById("logo-input")?.click()}>
                        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-[10px] text-white font-medium uppercase tracking-wider">Cambiar</span>
                      </div>
                    </div>
                  ) : (
                    <div 
                      onDragEnter={handleLogoDrag} 
                      onDragLeave={handleLogoDrag} 
                      onDragOver={handleLogoDrag} 
                      onDrop={handleLogoDrop} 
                      className="w-32 h-32 rounded-xl border border-dashed flex flex-col items-center justify-center p-3 text-center cursor-pointer transition-all hover:bg-zinc-800/30 flex-shrink-0" 
                      style={{ borderColor: logoDragActive ? "#10b981" : "var(--border)", background: logoDragActive ? "rgba(16,185,129,0.05)" : "transparent" }} 
                      onClick={() => document.getElementById("logo-input")?.click()}
                    >
                      <svg className={cn("w-6 h-6 mb-1 transition-colors", logoDragActive ? "text-emerald-500" : "text-zinc-500")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <span className="text-[10px] text-zinc-400 font-medium">Subir Logo</span>
                      <span className="text-[8px] text-zinc-600 mt-0.5">JPG, PNG, WebP</span>
                    </div>
                  )}

                  <input id="logo-input" type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" onChange={(e) => e.target.files?.[0] && handleLogoFile(e.target.files[0])} />
                  
                  {logoFile && (
                    <div className="w-full text-center">
                      <span className="text-[9px] text-emerald-400 font-mono block truncate max-w-[130px] mx-auto mb-1">
                        ✓ {logoFile.name}
                      </span>
                    </div>
                  )}
                  {logoError && <p className="text-[9px] font-medium text-destructive text-center">{logoError}</p>}
                </div>
              </div>
              
              {/* Right Side inside Config: Texts & Switches */}
              <div className="md:col-span-8 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-white mb-1.5 block">{t("link.edit.title_label")}</label>
                  <input 
                    type="text" 
                    value={editTitle} 
                    onChange={(e) => setEditTitle(e.target.value)} 
                    className="w-full px-3 py-2 rounded-lg border text-xs bg-zinc-950/40 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500" 
                    style={{ borderColor: "var(--border)" }} 
                    placeholder="Enviar demo" 
                  />
                </div>
                
                <div>
                  <label className="text-xs font-semibold text-white mb-1.5 block">{t("link.edit.desc_label")}</label>
                  <textarea 
                    value={editDescription} 
                    onChange={(e) => setEditDescription(e.target.value)} 
                    className="w-full px-3 py-2 rounded-lg border text-xs bg-zinc-950/40 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500" 
                    style={{ borderColor: "var(--border)" }} 
                    placeholder="Subí tu WAV. Analizamos BPM, LUFS, fase y headroom..." 
                    rows={3} 
                    suppressHydrationWarning 
                  />
                </div>

                {/* Switches for Instagram & SoundCloud */}
                <div className="pt-3 border-t space-y-3.5" style={{ borderColor: "var(--border-light)" }}>
                  <div className="flex items-center justify-between">
                    <div className="pr-4">
                      <label className="text-xs font-semibold text-white block">
                        Pedir Instagram
                      </label>
                      <span className="text-[10px] text-zinc-500 block mt-0.5">
                        Agrega un campo para el usuario de Instagram del productor.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAskInstagram(!askInstagram)}
                      className={cn(
                        "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                        askInstagram ? "bg-emerald-500" : "bg-zinc-700"
                      )}
                    >
                      <span
                        className={cn(
                          "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                          askInstagram ? "translate-x-4" : "translate-x-0"
                        )}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="pr-4">
                      <label className="text-xs font-semibold text-white block">
                        Pedir SoundCloud
                      </label>
                      <span className="text-[10px] text-zinc-500 block mt-0.5">
                        Agrega un campo para el usuario de SoundCloud del productor.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAskSoundcloud(!askSoundcloud)}
                      className={cn(
                        "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                        askSoundcloud ? "bg-emerald-500" : "bg-zinc-700"
                      )}
                    >
                      <span
                        className={cn(
                          "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                          askSoundcloud ? "translate-x-4" : "translate-x-0"
                        )}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Save Button Bar */}
            <div className="flex items-center gap-3 pt-5 mt-5 border-t justify-end" style={{ borderColor: "var(--border-light)" }}>
              {textsSaved && <span className="text-xs font-medium text-emerald-400">✓ Cambios guardados</span>}
              {textsError && <span className="text-xs font-medium text-destructive">{textsError}</span>}
              
              <button 
                onClick={handleSaveChanges} 
                disabled={savingTexts || logoUploading} 
                className="px-5 py-2 rounded-lg text-xs font-bold transition-all hover:brightness-110 disabled:opacity-50 min-w-[120px] flex items-center justify-center shadow-md" 
                style={{ background: "#10b981", color: "#09090b" }}
              >
                {savingTexts || logoUploading ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
                    Guardando...
                  </span>
                ) : (
                  "Guardar cambios"
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Interactive Submission Page Simulation / Preview */}
        <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-6">
          <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border)" }}>
            <span className="text-xs font-mono uppercase tracking-wider text-muted">{t("link.preview_label")}</span>
            <span className="text-[10px] px-2 py-0.5 rounded font-mono uppercase bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Vista previa en vivo</span>
          </div>

          <div className="rounded-xl border p-6 space-y-6" style={{ borderColor: "var(--border)", background: "#09090b" }}>
            
            {/* Logo and Label Name */}
            <div className="flex flex-col items-center text-center space-y-3 pb-4 border-b" style={{ borderColor: "var(--border)" }}>
              {(logoPreview || logoUrl) ? (
                <img 
                  src={logoPreview || logoUrl || ""} 
                  alt="Label logo" 
                  className="w-16 h-16 rounded-full object-cover border bg-secondary" 
                  style={{ borderColor: "var(--border)" }} 
                />
              ) : (
                <div className="w-16 h-16 rounded-full flex items-center justify-center font-bold text-lg" style={{ background: "#10b981", color: "#09090b" }}>
                  {labelName ? labelName.substring(0, 2).toUpperCase() : "LP"}
                </div>
              )}
              <div>
                <h2 className="font-display font-bold text-base text-white">{editTitle || "Enviar demo"}</h2>
                <p className="text-xs text-muted max-w-sm mx-auto mt-1 whitespace-pre-wrap">{editDescription}</p>
              </div>
            </div>

            {/* Simulating Form inputs */}
            <div className="space-y-4 text-left">
              <div>
                <label className="text-xs font-medium text-zinc-400 mb-1 block">Tu nombre</label>
                <div className="w-full px-3 py-2 rounded border text-xs bg-zinc-900/50 border-zinc-800 text-zinc-500">
                  DJ Krill
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-400 mb-1 block">Email</label>
                <div className="w-full px-3 py-2 rounded border text-xs bg-zinc-900/50 border-zinc-800 text-zinc-500">
                  tu@email.com
                </div>
              </div>

              {askInstagram && (
                <div>
                  <label className="text-xs font-medium text-zinc-400 mb-1 block">Instagram (opcional)</label>
                  <div className="w-full px-3 py-2 rounded border text-xs bg-zinc-900/50 border-zinc-800 text-zinc-500">
                    @djkrill
                  </div>
                </div>
              )}

              {askSoundcloud && (
                <div>
                  <label className="text-xs font-medium text-zinc-400 mb-1 block">SoundCloud (opcional)</label>
                  <div className="w-full px-3 py-2 rounded border text-xs bg-zinc-900/50 border-zinc-800 text-zinc-500">
                    djkrill
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-zinc-400 mb-1 block">Nombre del track</label>
                <div className="w-full px-3 py-2 rounded border text-xs bg-zinc-900/50 border-zinc-800 text-zinc-500">
                  Midnight Protocol
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-400 mb-1 block">Archivo de audio</label>
                <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center bg-zinc-900/20">
                  <div className="text-xs text-zinc-400 font-medium">Arrastrá tu audio acá</div>
                  <div className="text-[10px] text-zinc-600 mt-0.5">WAV, FLAC o AIFF · Max 200MB</div>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-400 mb-1 block">Observaciones adicionales (opcional)</label>
                <div className="w-full px-3 py-2 rounded border text-xs bg-zinc-900/50 border-zinc-800 text-zinc-500 h-16">
                  Referencias, notas de producción, etc.
                </div>
              </div>

              <button 
                type="button" 
                disabled 
                className="w-full py-2.5 rounded text-xs font-semibold bg-emerald-500 text-zinc-950 opacity-80 cursor-not-allowed transition-all"
              >
                {t("link.preview_submit")}
              </button>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
