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
  const [bpmRange, setBpmRange] = useState([120, 128]);
  const [lufsTarget, setLufsTarget] = useState(-14);
  const [lufsTolerance, setLufsTolerance] = useState(2);
  const [selectedCamelotKeys, setSelectedCamelotKeys] = useState<string[]>([]);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [autoReject, setAutoReject] = useState({ phase: true, tempo: true, clipping: false, dynamics: false });
  const [durationEnabled, setDurationEnabled] = useState(false);
  const [durationMax, setDurationMax] = useState(600);
  const [allowedFormats, setAllowedFormats] = useState<string[]>(["wav", "flac", "aiff"]);
  const [maxUploadSizeMb, setMaxUploadSizeMb] = useState<number>(100);

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
        setAutoReject({ 
          phase: sig.auto_reject_rules?.phase ?? true, 
          tempo: sig.auto_reject_rules?.tempo ?? true,
          clipping: sig.auto_reject_rules?.reject_clipping ?? sig.auto_reject_rules?.clipping ?? true, 
          dynamics: sig.auto_reject_rules?.reject_low_dynamic_range ?? sig.auto_reject_rules?.dynamics ?? true
        });
        setDurationEnabled(sig.duration_enabled ?? false);
        if (sig.duration_max) setDurationMax(sig.duration_max);
        setAllowedFormats(sig.allowed_formats ?? ["wav", "flac", "aiff"]);
        setMaxUploadSizeMb(sig.max_upload_size_mb ?? 100);
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
          setAutoReject({ 
            phase: sig.auto_reject_rules?.phase ?? true, 
            tempo: sig.auto_reject_rules?.tempo ?? true,
            clipping: sig.auto_reject_rules?.reject_clipping ?? true, 
            dynamics: sig.auto_reject_rules?.reject_low_dynamic_range ?? true
          });
          setDurationEnabled(sig.duration_enabled ?? false);
          if (sig.duration_max) setDurationMax(sig.duration_max);
          setAllowedFormats(sig.allowed_formats ?? ["wav", "flac", "aiff"]);
          setMaxUploadSizeMb(sig.max_upload_size_mb ?? 100);
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
        body: JSON.stringify({ sonic_signature: { bpm_min: bpmRange[0], bpm_max: bpmRange[1], lufs_target: lufsTarget, lufs_tolerance: lufsTolerance, target_camelot_keys: selectedCamelotKeys, preferred_scales: selectedCamelotKeys, duration_enabled: durationEnabled, duration_max: durationEnabled ? durationMax : null, auto_reject_rules: { phase: autoReject.phase, tempo: autoReject.tempo, reject_clipping: autoReject.clipping, reject_low_dynamic_range: autoReject.dynamics }, allowed_formats: allowedFormats, max_upload_size_mb: maxUploadSizeMb } }),
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
              phase: autoReject.phase,
              tempo: autoReject.tempo,
              reject_clipping: autoReject.clipping,
              reject_low_dynamic_range: autoReject.dynamics
            },
            allowed_formats: allowedFormats,
            max_upload_size_mb: maxUploadSizeMb
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
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 md:py-12">
      <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">{t("config.section_label")}</div>
      <h1 className="font-display font-semibold text-2xl mb-6">{t("config.title")}</h1>

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
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

        {/* Auto-Reject Rules */}
        <div className="rounded border p-5" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <label className="text-sm font-medium mb-3 block">{t("config.auto_reject_label")}</label>
          <div className="flex gap-2 flex-wrap">
            {[
              { key: "phase" as const, label: t("config.auto_reject.phase") }, 
              { key: "tempo" as const, label: t("config.auto_reject.tempo") },
              { key: "clipping" as const, label: t("config.auto_reject.clipping") },
              { key: "dynamics" as const, label: t("config.auto_reject.dynamics") }
            ].map((rule) => (
              <button key={rule.key} onClick={() => setAutoReject((prev) => ({ ...prev, [rule.key]: !prev[rule.key] }))} className="text-xs px-3 py-1.5 rounded-lg border transition-all active:scale-95" style={{ borderColor: autoReject[rule.key] ? "#ef4444" : "var(--border)", color: autoReject[rule.key] ? "#ef4444" : "var(--text-muted)", background: autoReject[rule.key] ? "rgba(239,68,68,0.1)" : "transparent" }}>{rule.label}</button>
            ))}
          </div>
        </div>

        {/* Save Button */}
        <div className="pt-6 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 text-sm font-medium rounded transition-all hover:opacity-90 disabled:opacity-50" style={{ background: "#10b981", color: "#09090b" }}>{saving ? t("config.saving") : t("config.save")}</button>
            {saved && (<span className="text-sm font-mono" style={{ color: "#10b981" }}>{t("config.saved")}</span>)}
            {saveError && (<span className="text-sm" style={{ color: "#ef4444" }}>{t("config.save_error")}: {saveError}</span>)}
          </div>
        </div>
        </div>

        {/* Info Sidebar */}
        <div className="lg:col-span-1">
          <div className="rounded border p-6 sticky top-24" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
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
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#ef4444" }}>{t("config.glossary.clipping.title")}</h4>
                <p className="text-sm text-muted">{t("config.glossary.clipping.desc")}</p>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#ef4444" }}>{t("config.glossary.dynamics.title")}</h4>
                <p className="text-sm text-muted">{t("config.glossary.dynamics.desc")}</p>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#ef4444" }}>{t("config.glossary.phase.title")}</h4>
                <p className="text-sm text-muted">{t("config.glossary.phase.desc")}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
