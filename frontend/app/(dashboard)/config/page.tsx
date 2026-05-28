"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n";
import { getCache, setCache } from "@/lib/cache";

interface SonicSignature {
  bpm_min: number;
  bpm_max: number;
  lufs_target: number;
  lufs_tolerance: number;
  preferred_scales: string[];
  target_camelot_keys?: string[];
  duration_enabled?: boolean;
  duration_max?: number;
  auto_reject_rules: { phase: boolean; tempo: boolean; clipping?: boolean; dynamics?: boolean; reject_clipping?: boolean; reject_low_dynamic_range?: boolean };
  allowed_formats?: string[];
  max_upload_size_mb?: number;
  auto_reject_enabled?: boolean;
  peak_limit_max?: number;
  crest_factor_min?: number;
  phase_correlation_min?: number;
}

const GENRE_PRESETS: Record<string, { bpm: [number, number]; lufs: number; durMax?: number; color: string }> = {
  "Techno": { bpm: [125, 142], lufs: -8, durMax: 450, color: "#06b6d4" },
  "House": { bpm: [120, 126], lufs: -10, durMax: 480, color: "#10b981" },
  "Tech House": { bpm: [124, 128], lufs: -8, durMax: 420, color: "#fbbf24" },
  "Progressive": { bpm: [120, 126], lufs: -10, durMax: 540, color: "#8b5cf6" },
  "Minimal / Deep Tech": { bpm: [123, 128], lufs: -11, durMax: 480, color: "#64748b" },
  "Drum & Bass": { bpm: [170, 178], lufs: -6, durMax: 360, color: "#ef4444" },
  "Melodic House & Techno": { bpm: [120, 126], lufs: -9, durMax: 540, color: "#ec4899" },
  "Trance": { bpm: [128, 140], lufs: -8, durMax: 500, color: "#3b82f6" },
  "Afro House": { bpm: [118, 124], lufs: -10, durMax: 480, color: "#f97316" },
};

export default function ConfigPage() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<"catalog" | "sonic_signature" | "glossary">("catalog");
  const [bpmRange, setBpmRange] = useState([120, 128]);
  const [lufsTarget, setLufsTarget] = useState(-14);
  const [lufsTolerance, setLufsTolerance] = useState(2);
  const [selectedCamelotKeys, setSelectedCamelotKeys] = useState<string[]>([]);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [autoRejectEnabled, setAutoRejectEnabled] = useState(true);
  const [durationEnabled, setDurationEnabled] = useState(false);
  const [durationMax, setDurationMax] = useState(600);
  const [allowedFormats, setAllowedFormats] = useState<string[]>(["wav", "flac", "aiff"]);
  const [maxUploadSizeMb, setMaxUploadSizeMb] = useState<number>(100);
  const [peakLimitMax, setPeakLimitMax] = useState(0.0);
  const [crestFactorMin, setCrestFactorMin] = useState(5.0);
  const [phaseCorrelationMin, setPhaseCorrelationMin] = useState(0.3);

  const [fetching, setFetching] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [noSlug, setNoSlug] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const API = "";

  const getAuthHeaders = useCallback((): Record<string, string> => ({ "Content-Type": "application/json" }), []);

  useEffect(() => {
    const fetchConfig = async () => {
      const slug = localStorage.getItem("slug");
      if (!slug) { setNoSlug(true); setFetching(false); return; }

      // Load from cache first to avoid initial layout shifts and loading flashes
      const cached = getCache<any>("tp_link_label_info", null);
      if (cached && cached.sonic_signature) {
        const sig: SonicSignature = typeof cached.sonic_signature === "string" 
          ? JSON.parse(cached.sonic_signature) 
          : cached.sonic_signature;
        setBpmRange([sig.bpm_min, sig.bpm_max]);
        setLufsTarget(sig.lufs_target);
        setLufsTolerance(sig.lufs_tolerance);
        setSelectedCamelotKeys(sig.target_camelot_keys ?? []);
        setAutoRejectEnabled(sig.auto_reject_enabled ?? true);
        setDurationEnabled(sig.duration_enabled ?? false);
        if (sig.duration_max) setDurationMax(sig.duration_max);
        setAllowedFormats(sig.allowed_formats ?? ["wav", "flac", "aiff"]);
        setMaxUploadSizeMb(sig.max_upload_size_mb ?? 100);
        setPeakLimitMax(sig.peak_limit_max ?? 0.0);
        setCrestFactorMin(sig.crest_factor_min ?? 5.0);
        setPhaseCorrelationMin(sig.phase_correlation_min ?? 0.3);
        setFetching(false);
      }

      try {
        const res = await fetch(`${API}/api/labels/${slug}`, { headers: getAuthHeaders(), credentials: "include" });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data = await res.json();
        
        // Save to cache
        setCache("tp_link_label_info", data);
        
        const sig: SonicSignature | null = data.sonic_signature;
        if (sig) {
          setBpmRange([sig.bpm_min, sig.bpm_max]);
          setLufsTarget(sig.lufs_target);
          setLufsTolerance(sig.lufs_tolerance);
          setSelectedCamelotKeys(sig.target_camelot_keys ?? []);
          setAutoRejectEnabled(sig.auto_reject_enabled ?? true);
          setDurationEnabled(sig.duration_enabled ?? false);
          if (sig.duration_max) setDurationMax(sig.duration_max);
          setAllowedFormats(sig.allowed_formats ?? ["wav", "flac", "aiff"]);
          setMaxUploadSizeMb(sig.max_upload_size_mb ?? 100);
          setPeakLimitMax(sig.peak_limit_max ?? 0.0);
          setCrestFactorMin(sig.crest_factor_min ?? 5.0);
          setPhaseCorrelationMin(sig.phase_correlation_min ?? 0.3);
        }
      } catch (e) { 
        if (!cached) {
          setFetchError(e instanceof Error ? e.message : t("inbox.error_unknown")); 
        }
      } finally { 
        setFetching(false); 
      }
    };
    fetchConfig();
  }, [API, getAuthHeaders]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  const camelotKeys = [
    "1B", "2B", "3B", "4B", "5B", "6B", "7B", "8B", "9B", "10B", "11B", "12B",
    "1A", "2A", "3A", "4A", "5A", "6A", "7A", "8A", "9A", "10A", "11A", "12A"
  ];

  const toggleCamelotKey = (key: string) => {
    setSelectedCamelotKeys((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  };

  const handleSave = async () => {
    const slug = localStorage.getItem("slug");
    if (!slug) return;
    setSaving(true); setSaveError(null); setSaved(false);
    try {
      const res = await fetch(`${API}/api/labels/${slug}/config`, {
        method: "PUT", headers: getAuthHeaders(), credentials: "include",
        body: JSON.stringify({ sonic_signature: { bpm_min: bpmRange[0], bpm_max: bpmRange[1], lufs_target: lufsTarget, lufs_tolerance: lufsTolerance, target_camelot_keys: selectedCamelotKeys, preferred_scales: selectedCamelotKeys, duration_enabled: durationEnabled, duration_max: durationEnabled ? durationMax : null, auto_reject_rules: { phase: true, tempo: true, reject_clipping: true, reject_low_dynamic_range: true }, allowed_formats: allowedFormats, max_upload_size_mb: maxUploadSizeMb, auto_reject_enabled: autoRejectEnabled, peak_limit_max: peakLimitMax, crest_factor_min: crestFactorMin, phase_correlation_min: phaseCorrelationMin } }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      
      // Update cache
      const cachedLabel = getCache<any>("tp_link_label_info", null);
      if (cachedLabel) {
        const nextLabel = {
          ...cachedLabel,
          sonic_signature: {
            bpm_min: bpmRange[0],
            bpm_max: bpmRange[1],
            lufs_target: lufsTarget,
            lufs_tolerance: lufsTolerance,
            target_camelot_keys: selectedCamelotKeys,
            preferred_scales: selectedCamelotKeys,
            duration_enabled: durationEnabled,
            duration_max: durationEnabled ? durationMax : null,
            auto_reject_rules: {
              phase: true,
              tempo: true,
              reject_clipping: true,
              reject_low_dynamic_range: true
            },
            allowed_formats: allowedFormats,
            max_upload_size_mb: maxUploadSizeMb,
            auto_reject_enabled: autoRejectEnabled,
            peak_limit_max: peakLimitMax,
            crest_factor_min: crestFactorMin,
            phase_correlation_min: phaseCorrelationMin
          }
        };
        setCache("tp_link_label_info", nextLabel);
      }

      setSaved(true);
    } catch (e) { setSaveError(e instanceof Error ? e.message : t("inbox.error_unknown")); }
    finally { setSaving(false); }
  };

  const togglePreset = (genre: string) => {
    if (activePreset === genre) {
      setActivePreset(null);
    } else {
      applyPreset(genre);
      setActivePreset(genre);
    }
  };

  const applyPreset = (genre: string) => {
    const p = GENRE_PRESETS[genre];
    if (!p) return;
    setBpmRange(p.bpm); setLufsTarget(p.lufs);
    if (p.durMax) { setDurationMax(p.durMax); setDurationEnabled(true); }
  };

  if (noSlug) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">{t("config.section_label")}</div>
        <div className="rounded border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <p className="text-sm" style={{ color: "#ef4444" }}>{t("config.no_slug")}</p>
        </div>
      </div>
    );
  }

  if (fetching) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 md:py-12 space-y-6 animate-pulse">
        <div>
          <div className="h-3 bg-zinc-800 rounded w-24 mb-2" />
          <div className="h-8 bg-zinc-800 rounded w-48" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {/* Presets skeleton */}
            <div className="space-y-3">
              <div className="h-4 bg-zinc-800 rounded w-32" />
              <div className="flex gap-2 flex-wrap">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <div key={i} className="h-7 bg-zinc-900 rounded-lg w-20 opacity-70" style={{ animationDelay: `${i * 100}ms` }} />
                ))}
              </div>
            </div>

            {/* Stat box skeletons (BPM, LUFS, Duration) */}
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded border p-5 bg-[var(--bg-secondary)] border-[var(--border)] space-y-4 opacity-75" style={{ animationDelay: `${i * 150}ms` }}>
                <div className="flex items-center justify-between">
                  <div className="h-4 bg-zinc-800 rounded w-1/4" />
                  <div className="h-6 bg-zinc-900 rounded w-24" />
                </div>
                <div className="h-2 bg-zinc-900 rounded w-full" />
              </div>
            ))}

            {/* Allowed Formats & Max Upload size skeleton */}
            <div className="rounded border p-5 bg-[var(--bg-secondary)] border-[var(--border)] grid grid-cols-1 md:grid-cols-2 gap-6 opacity-75">
              <div className="space-y-3">
                <div className="h-4 bg-zinc-800 rounded w-1/3" />
                <div className="flex gap-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-8 bg-zinc-900 rounded-lg flex-1" />
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <div className="h-4 bg-zinc-800 rounded w-1/3" />
                <div className="h-2 bg-zinc-900 rounded w-full" />
              </div>
            </div>

            {/* Camelot Wheel grid skeleton */}
            <div className="rounded border p-5 bg-[var(--bg-secondary)] border-[var(--border)] space-y-4 opacity-60">
              <div className="h-4 bg-zinc-800 rounded w-1/4" />
              <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5">
                {Array.from({ length: 24 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-md bg-zinc-900 border border-zinc-800/80" style={{ animationDelay: `${(i % 12) * 50}ms` }} />
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar skeleton */}
          <div className="lg:col-span-1">
            <div className="rounded border p-6 bg-[var(--bg-secondary)] border-[var(--border)] space-y-6 opacity-50">
              <div className="h-5 bg-zinc-800 rounded w-1/2 pb-2" />
              <div className="space-y-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-3 bg-zinc-800 rounded w-1/3" />
                    <div className="h-10 bg-zinc-900 rounded w-full" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">{t("config.section_label")}</div>
        <h1 className="font-display font-semibold text-2xl mb-8">{t("config.title")}</h1>
        <div className="rounded border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <p className="text-sm" style={{ color: "#ef4444" }}>{t("config.error_load")}: {fetchError}</p>
          <button onClick={() => { setFetching(true); setFetchError(null); }} className="mt-4 px-4 py-2 rounded text-sm font-medium" style={{ background: "#10b981", color: "#09090b" }}>{t("config.retry")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 md:py-12">
      <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">{t("config.section_label")}</div>
      <h1 className="font-display font-semibold text-2xl mb-6">{t("config.title")}</h1>

      {/* Tabs Selector */}
      <div className="flex border-b border-zinc-800 gap-2 mb-8 overflow-x-auto pb-px">
        {(["catalog", "sonic_signature", "glossary"] as const).map((tab) => {
          const tabLabel = {
            catalog: t("config.tab.catalog") || "Catálogo y Formatos",
            sonic_signature: t("config.tab.sonic_signature") || "Firma Sónica",
            glossary: t("config.tab.glossary") || "Glosario Técnico",
          }[tab];
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap -mb-px ${
                active
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {tabLabel}
            </button>
          );
        })}
      </div>

      <div className="space-y-6">
        {/* Tab 1: Catalog & Formats */}
        {activeTab === "catalog" && (
          <>
            {/* Genre Preset Selector */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">{t("config.preset_label")}</label>
                <span className="text-[10px] text-muted">{t("config.preset_hint")}</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {Object.keys(GENRE_PRESETS).map((g) => (
                  <button 
                    key={g} 
                    onClick={() => togglePreset(g)} 
                    className="px-4 py-1.5 rounded-lg text-xs font-semibold border transition-all active:scale-95" 
                    style={{ 
                      borderColor: activePreset === g ? "#10b981" : "var(--border)", 
                      background: activePreset === g ? "rgba(16,185,129,0.1)" : "transparent", 
                      color: activePreset === g ? "#10b981" : "var(--text-muted)" 
                    }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* BPM Range */}
            <div className="rounded border p-5" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium">{t("config.bpm_label")}</label>
                <span className="font-mono text-sm px-3 py-1 rounded-lg" style={{ background: "var(--bg-card)" }}>{bpmRange[0]} — {bpmRange[1]}</span>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center justify-between mb-1"><span className="text-xs text-muted">{t("config.bpm_min")}</span><span className="font-mono text-xs" style={{ color: "#10b981" }}>{bpmRange[0]}</span></div>
                  <input type="range" min={60} max={200} value={bpmRange[0]} onChange={(e) => { setBpmRange([Math.min(+e.target.value, bpmRange[1] - 5), bpmRange[1]]); setActivePreset(null); }} className="w-full cursor-pointer accent-emerald-500" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1"><span className="text-xs text-muted">{t("config.bpm_max")}</span><span className="font-mono text-xs" style={{ color: "#10b981" }}>{bpmRange[1]}</span></div>
                  <input type="range" min={60} max={200} value={bpmRange[1]} onChange={(e) => { setBpmRange([bpmRange[0], Math.max(+e.target.value, bpmRange[0] + 5)]); setActivePreset(null); }} className="w-full cursor-pointer accent-emerald-500" />
                </div>
              </div>
            </div>

            {/* LUFS Target */}
            <div className="rounded border p-5" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium">{t("config.lufs_label")}</label>
                <span className="font-mono text-sm px-3 py-1 rounded-lg" style={{ background: "var(--bg-card)" }}>{lufsTarget} LUFS ± {lufsTolerance}</span>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center justify-between mb-1"><span className="text-xs text-muted">{t("config.lufs_target")}</span><span className="font-mono text-xs" style={{ color: "#10b981" }}>{lufsTarget}</span></div>
                  <input type="range" min={-20} max={-6} value={lufsTarget} onChange={(e) => { setLufsTarget(+e.target.value); setActivePreset(null); }} className="w-full cursor-pointer accent-emerald-500" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1"><span className="text-xs text-muted">{t("config.lufs_tolerance")}</span><span className="font-mono text-xs" style={{ color: "#10b981" }}>± {lufsTolerance}</span></div>
                  <input type="range" min={0.5} max={4} step={0.5} value={lufsTolerance} onChange={(e) => { setLufsTolerance(+e.target.value); setActivePreset(null); }} className="w-full cursor-pointer accent-emerald-500" />
                </div>
              </div>
            </div>

            {/* Duration Range */}
            <div className="rounded border p-5" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium">{t("config.duration_label")}</label>
                  <button onClick={() => setDurationEnabled((p) => !p)} className="relative w-9 h-5 rounded-full transition-colors cursor-pointer" style={{ background: durationEnabled ? "#10b981" : "var(--border)" }}>
                    <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform" style={{ left: durationEnabled ? "calc(100% - 18px)" : "2px" }} />
                  </button>
                </div>
                {durationEnabled && <span className="font-mono text-xs px-2 py-1 rounded-lg" style={{ background: "var(--bg-card)" }}>{Math.floor(durationMax / 60)}:{String(durationMax % 60).padStart(2, "0")}</span>}
              </div>
              {durationEnabled && (
                <div>
                  <div className="flex items-center justify-between mb-1"><span className="text-xs text-muted">{t("config.bpm_max")}</span><span className="font-mono text-xs" style={{ color: "#10b981" }}>{Math.floor(durationMax / 60)}:{String(durationMax % 60).padStart(2, "0")}</span></div>
                  <input type="range" min={0} max={1200} step={30} value={durationMax} onChange={(e) => setDurationMax(+e.target.value)} className="w-full cursor-pointer accent-emerald-500" />
                  <div className="flex justify-between text-[10px] font-mono text-muted mt-1"><span>0:00</span><span>20:00</span></div>
                </div>
              )}
            </div>

            {/* Upload Limits (Formats and Size) */}
            <div className="rounded border p-5" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Allowed Formats */}
                <div>
                  <label className="text-sm font-medium mb-3 block">{t("config.formats_label")}</label>
                  <div className="flex gap-2">
                    {["wav", "flac", "aiff"].map((fmt) => {
                      const isActive = allowedFormats.includes(fmt);
                      return (
                        <button
                          key={fmt}
                          onClick={() => {
                            setAllowedFormats((prev) => {
                              if (prev.includes(fmt)) {
                                if (prev.length === 1) return prev;
                                return prev.filter((f) => f !== fmt);
                              }
                              return [...prev, fmt];
                            });
                          }}
                          className="px-4 py-2 rounded-lg text-xs font-semibold border transition-all active:scale-95 flex-1 text-center"
                          style={{
                            borderColor: isActive ? "#10b981" : "var(--border)",
                            background: isActive ? "rgba(16,185,129,0.1)" : "transparent",
                            color: isActive ? "#10b981" : "var(--text-muted)"
                          }}
                        >
                          {fmt.toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Max Upload Size */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-medium">{t("config.max_size_label")}</label>
                    <span className="font-mono text-xs px-2.5 py-0.5 rounded-lg" style={{ background: "var(--bg-card)", color: "#10b981" }}>{maxUploadSizeMb} MB</span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={200}
                    step={10}
                    value={maxUploadSizeMb}
                    onChange={(e) => setMaxUploadSizeMb(+e.target.value)}
                    className="w-full cursor-pointer accent-emerald-500"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-muted mt-1">
                    <span>50 MB</span>
                    <span>200 MB</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Camelot Wheel Selection */}
            <div className="rounded border p-5" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
              <label className="text-sm font-medium mb-4 block">{t("config.scales_label")}</label>
              <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5">
                {camelotKeys.map((k) => (
                  <button 
                    key={k} 
                    onClick={() => toggleCamelotKey(k)} 
                    className="aspect-square flex items-center justify-center text-[10px] font-bold rounded-md border transition-all active:scale-95" 
                    style={{ 
                      borderColor: selectedCamelotKeys.includes(k) ? "#10b981" : "var(--border)", 
                      color: selectedCamelotKeys.includes(k) ? "#09090b" : "var(--text-muted)", 
                      background: selectedCamelotKeys.includes(k) ? "#10b981" : "transparent",
                      opacity: selectedCamelotKeys.includes(k) ? 1 : 0.6
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted mt-3 italic">Sistema Camelot: Fila superior (B) para tonos Mayores, fila inferior (A) para tonos Menores.</p>
            </div>
          </>
        )}

        {/* Tab 2: Audio Limits (Sonic Signature) */}
        {activeTab === "sonic_signature" && (
          <>
            <div className="rounded border p-5" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--border)]">
                <label className="text-sm font-semibold">{t("config.tech_limits_label")}</label>
                <span className="text-[10px] text-muted">{t("config.tech_limits_desc")}</span>
              </div>

              <div className="space-y-6">
                {/* True Peak / Clipping */}
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-500">{t("config.slider_clipping_title")}</h4>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted">{t("config.peak_limit_max")}</span>
                      <span className="font-mono text-xs font-semibold animate-fade-in" style={{ color: "#10b981" }}>{peakLimitMax.toFixed(1)} dB</span>
                    </div>
                    <input 
                      type="range" 
                      min={-2.0} 
                      max={0.0} 
                      step={0.1} 
                      value={peakLimitMax} 
                      onChange={(e) => setPeakLimitMax(+e.target.value)} 
                      className="w-full cursor-pointer accent-emerald-500" 
                    />
                    <div className="flex justify-between text-[10px] font-mono text-muted mt-0.5">
                      <span>-2.0 dB</span>
                      <span>0.0 dB</span>
                    </div>
                  </div>
                  {/* Dynamic visual range bar */}
                  <div className="space-y-1.5 mt-2">
                    <div className="h-1.5 w-full rounded-full flex overflow-hidden bg-zinc-800">
                      <div className="bg-emerald-500/80 h-full" style={{ width: "50%" }} />
                      <div className="bg-amber-500/80 h-full" style={{ width: "30%" }} />
                      <div className="bg-rose-500/80 h-full" style={{ width: "20%" }} />
                    </div>
                    <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                      <span className="text-emerald-400 font-semibold">Óptimo (≤ {peakLimitMax.toFixed(1)} dB)</span>
                      <span className="text-amber-400 font-semibold">Warning (&lt; {(peakLimitMax + 1.5).toFixed(1)} dB)</span>
                      <span className="text-rose-400 font-semibold">Auto-Rechazo (&gt; {(peakLimitMax + 1.5).toFixed(1)} dB)</span>
                    </div>
                  </div>
                </div>

                {/* Crest Factor / Dynamics */}
                <div className="space-y-3 pt-4 border-t border-[var(--border)]">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-500">{t("config.slider_dynamics_title")}</h4>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted">{t("config.crest_factor_min")}</span>
                      <span className="font-mono text-xs font-semibold animate-fade-in" style={{ color: "#10b981" }}>{crestFactorMin.toFixed(1)} dB</span>
                    </div>
                    <input 
                      type="range" 
                      min={4.0} 
                      max={10.0} 
                      step={0.1} 
                      value={crestFactorMin} 
                      onChange={(e) => setCrestFactorMin(+e.target.value)} 
                      className="w-full cursor-pointer accent-emerald-500" 
                    />
                    <div className="flex justify-between text-[10px] font-mono text-muted mt-0.5">
                      <span>4.0 dB</span>
                      <span>10.0 dB</span>
                    </div>
                  </div>
                  {/* Dynamic visual range bar */}
                  <div className="space-y-1.5 mt-2">
                    <div className="h-1.5 w-full rounded-full flex overflow-hidden bg-zinc-800">
                      <div className="bg-rose-500/80 h-full" style={{ width: "20%" }} />
                      <div className="bg-amber-500/80 h-full" style={{ width: "30%" }} />
                      <div className="bg-emerald-500/80 h-full" style={{ width: "50%" }} />
                    </div>
                    <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                      <span className="text-rose-400 font-semibold">Auto-Rechazo (&lt; {Math.max(crestFactorMin - 1.5, 2.0).toFixed(1)} dB)</span>
                      <span className="text-amber-400 font-semibold">Warning (≤ {crestFactorMin.toFixed(1)} dB)</span>
                      <span className="text-emerald-400 font-semibold">Óptimo (≥ {crestFactorMin.toFixed(1)} dB)</span>
                    </div>
                  </div>
                </div>

                {/* Phase Correlation / Mono Compatibility */}
                <div className="space-y-3 pt-4 border-t border-[var(--border)]">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-500">{t("config.slider_phase_title")}</h4>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted">{t("config.phase_correlation_min")}</span>
                      <span className="font-mono text-xs font-semibold animate-fade-in" style={{ color: "#10b981" }}>{phaseCorrelationMin.toFixed(2)}</span>
                    </div>
                    <input 
                      type="range" 
                      min={0.0} 
                      max={0.5} 
                      step={0.05} 
                      value={phaseCorrelationMin} 
                      onChange={(e) => setPhaseCorrelationMin(+e.target.value)} 
                      className="w-full cursor-pointer accent-emerald-500" 
                    />
                    <div className="flex justify-between text-[10px] font-mono text-muted mt-0.5">
                      <span>0.0</span>
                      <span>0.5</span>
                    </div>
                  </div>
                  {/* Dynamic visual range bar */}
                  <div className="space-y-1.5 mt-2">
                    <div className="h-1.5 w-full rounded-full flex overflow-hidden bg-zinc-800">
                      <div className="bg-rose-500/80 h-full" style={{ width: "20%" }} />
                      <div className="bg-amber-500/80 h-full" style={{ width: "30%" }} />
                      <div className="bg-emerald-500/80 h-full" style={{ width: "50%" }} />
                    </div>
                    <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                      <span className="text-rose-400 font-semibold">Auto-Rechazo (&lt; {Math.max(phaseCorrelationMin - 0.3, -0.2).toFixed(2)})</span>
                      <span className="text-amber-400 font-semibold">Warning (≤ {phaseCorrelationMin.toFixed(2)})</span>
                      <span className="text-emerald-400 font-semibold">Óptimo (≥ {phaseCorrelationMin.toFixed(2)})</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Auto-Reject — Master Switch Only */}
            <div className="rounded border p-5" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium">{t("config.auto_reject_label")}</label>
                  <button onClick={() => setAutoRejectEnabled((p) => !p)} className="relative w-9 h-5 rounded-full transition-colors cursor-pointer" style={{ background: autoRejectEnabled ? "#ef4444" : "var(--border)" }}>
                    <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform" style={{ left: autoRejectEnabled ? "calc(100% - 18px)" : "2px" }} />
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted">
                {t("config.auto_reject.enabled_desc")}
              </p>
              {autoRejectEnabled && (
                <div className="mt-3 px-3 py-2 rounded-lg text-xs font-mono" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)", color: "#f87171" }}>
                  {t("config.auto_reject.active_info")}
                </div>
              )}
            </div>
          </>
        )}

        {/* Tab 3: Glossary */}
        {activeTab === "glossary" && (
          <div className="rounded border p-6" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
            <h3 className="font-display font-semibold text-base mb-6 pb-4 border-b" style={{ borderColor: "var(--border)" }}>
              {t("config.glossary.title")}
            </h3>
            
            <div className="space-y-6">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#10b981" }}>{t("config.glossary.bpm.title")}</h4>
                <p className="text-sm text-muted">{t("config.glossary.bpm.desc")}</p>
              </div>
              
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#10b981" }}>{t("config.glossary.lufs.title")}</h4>
                <p className="text-sm text-muted">{t("config.glossary.lufs.desc")}</p>
              </div>
              
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#10b981" }}>{t("config.glossary.duration.title")}</h4>
                <p className="text-sm text-muted">{t("config.glossary.duration.desc")}</p>
              </div>
              
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#10b981" }}>{t("config.glossary.scales.title")}</h4>
                <p className="text-sm text-muted">{t("config.glossary.scales.desc")}</p>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#fbbf24" }}>{t("config.glossary.clipping.title")}</h4>
                <p className="text-sm text-muted">{t("config.glossary.clipping.desc")}</p>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#fbbf24" }}>{t("config.glossary.dynamics.title")}</h4>
                <p className="text-sm text-muted">{t("config.glossary.dynamics.desc")}</p>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#fbbf24" }}>{t("config.glossary.phase.title")}</h4>
                <p className="text-sm text-muted">{t("config.glossary.phase.desc")}</p>
              </div>
            </div>
          </div>
        )}

        {/* Save Button (Persistent outside the tabs content, but within the single column) */}
        <div className="pt-6 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 text-sm font-medium rounded transition-all hover:opacity-90 disabled:opacity-50" style={{ background: "#10b981", color: "#09090b" }}>{saving ? t("config.saving") : t("config.save")}</button>
            {saved && (<span className="text-sm font-mono" style={{ color: "#10b981" }}>{t("config.saved")}</span>)}
            {saveError && (<span className="text-sm" style={{ color: "#ef4444" }}>{t("config.save_error")}: {saveError}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}
