"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface SonicSignature {
  bpm_min: number;
  bpm_max: number;
  lufs_target: number;
  lufs_tolerance: number;
  preferred_scales: string[];
  duration_enabled?: boolean;
  duration_max?: number;
  auto_reject_rules: {
    phase: boolean;
    lufs: boolean;
    tempo: boolean;
  };
}

const GENRE_PRESETS: Record<string, { bpm: [number, number]; lufs: number; scales: string[]; durMax?: number }> = {
  "Progressive House": { bpm: [120, 128], lufs: -10, scales: ["Menor"], durMax: 480 },
  "Melodic Techno": { bpm: [120, 126], lufs: -10, scales: ["Menor"], durMax: 480 },
  "Techno": { bpm: [128, 140], lufs: -9, scales: ["Menor"], durMax: 420 },
  "House": { bpm: [122, 128], lufs: -10, scales: ["Menor"], durMax: 420 },
  "Deep House": { bpm: [115, 125], lufs: -12, scales: ["Menor"], durMax: 420 },
  "Tech House": { bpm: [124, 130], lufs: -9, scales: ["Menor"], durMax: 420 },
  "Minimal": { bpm: [124, 130], lufs: -12, scales: ["Menor"], durMax: 480 },
  "Drum & Bass": { bpm: [160, 180], lufs: -7, scales: ["Menor"], durMax: 360 },
  "Trance": { bpm: [134, 142], lufs: -8, scales: ["Menor"], durMax: 480 },
};

export default function ConfigPage() {
  const [bpmRange, setBpmRange] = useState([120, 128]);
  const [lufsTarget, setLufsTarget] = useState(-14);
  const [lufsTolerance, setLufsTolerance] = useState(2);
  const [selectedScales, setSelectedScales] = useState<string[]>(["Menor"]);
  const [autoReject, setAutoReject] = useState({
    phase: true,
    lufs: true,
    tempo: true,
  });
  const [durationEnabled, setDurationEnabled] = useState(false);
  const [durationMax, setDurationMax] = useState(600); // max in seconds (default 10min)

  // Logo upload state
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoSaved, setLogoSaved] = useState(false);
  const [logoDragActive, setLogoDragActive] = useState(false);

  // Fetch / save state
  const [fetching, setFetching] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [noSlug, setNoSlug] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const API = process.env.NEXT_PUBLIC_API_URL;

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const token = localStorage.getItem("token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }, []);

  // Fetch label config on mount
  useEffect(() => {
    const fetchConfig = async () => {
      const slug = localStorage.getItem("slug");
      if (!slug) {
        setNoSlug(true);
        setFetching(false);
        return;
      }
      try {
        const res = await fetch(`${API}/api/labels/${slug}`, {
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data = await res.json();
        const sig: SonicSignature | null = data.sonic_signature;
        if (sig) {
          setBpmRange([sig.bpm_min, sig.bpm_max]);
          setLufsTarget(sig.lufs_target);
          setLufsTolerance(sig.lufs_tolerance);
          setSelectedScales(sig.preferred_scales ?? []);
          setAutoReject({
            phase: sig.auto_reject_rules?.phase ?? true,
            lufs: sig.auto_reject_rules?.lufs ?? true,
            tempo: sig.auto_reject_rules?.tempo ?? true,
          });
          setDurationEnabled(sig.duration_enabled ?? false);
          if (sig.duration_max) setDurationMax(sig.duration_max);
        }
        if (data.logo_path) {
          setLogoUrl(`${API}/logos/${data.logo_path}`);
        }
      } catch (e) {
        setFetchError(e instanceof Error ? e.message : "Error desconocido");
      } finally {
        setFetching(false);
      }
    };
    fetchConfig();
  }, [API, getAuthHeaders]);

  // Auto-dismiss success message after 2s
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  const scales = ["Menor", "Mayor", "Dórica", "Frigia"];

  const toggleScale = (scale: string) => {
    setSelectedScales((prev) =>
      prev.includes(scale) ? prev.filter((s) => s !== scale) : [...prev, scale]
    );
  };

  const handleSave = async () => {
    const slug = localStorage.getItem("slug");
    if (!slug) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await fetch(`${API}/api/labels/${slug}/config`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          sonic_signature: {
            bpm_min: bpmRange[0],
            bpm_max: bpmRange[1],
            lufs_target: lufsTarget,
            lufs_tolerance: lufsTolerance,
            preferred_scales: selectedScales,
            duration_enabled: durationEnabled,
            duration_max: durationEnabled ? durationMax : null,
            auto_reject_rules: {
              phase: autoReject.phase,
              lufs: autoReject.lufs,
              tempo: autoReject.tempo,
            },
          },
        }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  };

  // Logo upload
  const handleLogoFile = (f: File) => {
    const validExts = [".jpg", ".jpeg", ".png", ".webp"];
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    if (!validExts.includes(ext)) {
      setLogoError("Solo se aceptan imágenes JPG, PNG o WebP");
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setLogoError("La imagen no puede superar los 5MB");
      return;
    }
    setLogoError(null);
    setLogoFile(f);
    const reader = new FileReader();
    reader.onload = (e) => setLogoPreview(e.target?.result as string);
    reader.readAsDataURL(f);
  };

  const handleLogoDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLogoDragActive(false);
    const files = e.dataTransfer.files;
    if (files && files[0]) handleLogoFile(files[0]);
  };

  const handleLogoDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setLogoDragActive(true);
    else if (e.type === "dragleave") setLogoDragActive(false);
  };

  const uploadLogo = async () => {
    if (!logoFile) return;
    const slug = localStorage.getItem("slug");
    if (!slug) return;
    setLogoUploading(true);
    setLogoError(null);
    try {
      const formData = new FormData();
      formData.append("file", logoFile);
      const token = localStorage.getItem("token");
      const res = await fetch(`${API}/api/labels/${slug}/logo`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Error desconocido" }));
        throw new Error(err.detail || `Error ${res.status}`);
      }
      const data = await res.json();
      setLogoUrl(`${API}${data.logo_url}`);
      setLogoSaved(true);
      setLogoFile(null);
      setLogoPreview(null);
      setTimeout(() => setLogoSaved(false), 2000);
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLogoUploading(false);
    }
  };

  if (noSlug) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Configuración</div>
        <div className="rounded border p-8 text-center" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
          <p className="text-sm" style={{ color: "#ef4444" }}>No se encontró tu sello. Iniciá sesión de nuevo.</p>
        </div>
      </div>
    );
  }

  if (fetching) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Configuración</div>
        <h1 className="font-display font-semibold text-2xl mb-8">Firma sónica — Sello principal</h1>
        <div className="rounded border p-8 text-center animate-pulse" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
          <p className="text-sm text-muted">Cargando configuración...</p>
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Configuración</div>
        <h1 className="font-display font-semibold text-2xl mb-8">Firma sónica — Sello principal</h1>
        <div className="rounded border p-8 text-center" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
          <p className="text-sm" style={{ color: "#ef4444" }}>Error al cargar configuración: {fetchError}</p>
          <button
            onClick={() => { setFetching(true); setFetchError(null); }}
            className="mt-4 px-4 py-2 rounded text-sm font-medium"
            style={{ background: "#10b981", color: "#09090b" }}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const applyPreset = (genre: string) => {
    const p = GENRE_PRESETS[genre];
    if (!p) return;
    setBpmRange(p.bpm);
    setLufsTarget(p.lufs);
    setSelectedScales(p.scales);
    if (p.durMax) { setDurationMax(p.durMax); setDurationEnabled(true); }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 md:py-12">
      <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Configuración</div>
      <h1 className="font-display font-semibold text-2xl mb-6">Firma sónica — Sello principal</h1>

      {/* Genre Preset Selector */}
      <div className="mb-6 flex items-center gap-3">
        <label className="text-sm font-medium whitespace-nowrap">Preset:</label>
        <select
          onChange={(e) => { if (e.target.value) applyPreset(e.target.value); e.target.value = ""; }}
          className="flex-1 px-3 py-2 rounded border text-sm bg-transparent cursor-pointer"
          style={{ borderColor: "#27272a", color: "#fafafa", maxWidth: "240px" }}
          defaultValue=""
        >
          <option value="" disabled style={{ color: "#71717a" }}>Elegí un género...</option>
          {Object.keys(GENRE_PRESETS).map((g) => (
            <option key={g} value={g} style={{ background: "#0c0c0e", color: "#fafafa" }}>{g}</option>
          ))}
        </select>
        <span className="text-[10px] text-muted">Carga valores sugeridos</span>
      </div>

      <div className="space-y-6">
        {/* Logo Upload */}
        <div className="rounded-xl border p-5" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
          <label className="text-sm font-medium mb-3 block">Logo del sello</label>
          <div className="flex items-center gap-3">
            {(logoPreview || logoUrl) && (
              <img src={logoPreview || logoUrl || ""} alt="Logo" className="w-14 h-14 rounded-xl object-cover border flex-shrink-0" style={{ borderColor: "#27272a" }} />
            )}
            <div className="flex items-center gap-2">
              <div
                onDragEnter={handleLogoDrag} onDragLeave={handleLogoDrag} onDragOver={handleLogoDrag} onDrop={handleLogoDrop}
                className="rounded-xl border border-dashed px-4 py-3 text-xs cursor-pointer transition-colors"
                style={{ borderColor: logoDragActive ? "#10b981" : "#27272a", background: logoDragActive ? "rgba(16,185,129,0.05)" : "transparent", maxWidth: "280px" }}
                onClick={() => document.getElementById("logo-input")?.click()}
              >
                <input id="logo-input" type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" onChange={(e) => e.target.files?.[0] && handleLogoFile(e.target.files[0])} />
                <span className="text-muted">{logoPreview ? `${logoFile?.name} (${(logoFile!.size / 1024).toFixed(0)} KB)` : logoUrl ? "Clic para cambiar logo" : "Clic o arrastrá · JPG, PNG · Max 5MB"}</span>
              </div>
              {logoFile && (
                <button onClick={uploadLogo} disabled={logoUploading} className="px-4 py-2 text-xs font-medium rounded-lg transition-all hover:opacity-90 disabled:opacity-50 flex-shrink-0" style={{ background: "#10b981", color: "#09090b" }}>
                  {logoUploading ? "Subiendo..." : "Guardar"}
                </button>
              )}
            </div>
          </div>
          {logoError && <div className="mt-2 text-xs" style={{ color: "#ef4444" }}>{logoError}</div>}
          {logoSaved && <div className="mt-2 text-xs font-mono" style={{ color: "#10b981" }}>Logo guardado</div>}
        </div>

        {/* BPM Range */}
        <div className="rounded-xl border p-5" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
          <div className="flex items-center justify-between mb-4">
            <label className="text-sm font-medium">Rango de BPM</label>
            <span className="font-mono text-sm px-3 py-1 rounded-lg" style={{ background: "#111114" }}>{bpmRange[0]} — {bpmRange[1]}</span>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted">Mínimo</span>
                <span className="font-mono text-xs" style={{ color: "#10b981" }}>{bpmRange[0]}</span>
              </div>
              <input type="range" min={60} max={200} value={bpmRange[0]} onChange={(e) => setBpmRange([Math.min(+e.target.value, bpmRange[1] - 5), bpmRange[1]])} className="w-full cursor-pointer accent-emerald-500" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted">Máximo</span>
                <span className="font-mono text-xs" style={{ color: "#10b981" }}>{bpmRange[1]}</span>
              </div>
              <input type="range" min={60} max={200} value={bpmRange[1]} onChange={(e) => setBpmRange([bpmRange[0], Math.max(+e.target.value, bpmRange[0] + 5)])} className="w-full cursor-pointer accent-emerald-500" />
            </div>
          </div>
        </div>

        {/* LUFS Target */}
        <div className="rounded-xl border p-5" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
          <div className="flex items-center justify-between mb-4">
            <label className="text-sm font-medium">LUFS objetivo</label>
            <span className="font-mono text-sm px-3 py-1 rounded-lg" style={{ background: "#111114" }}>{lufsTarget} LUFS ± {lufsTolerance}</span>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted">Target</span>
                <span className="font-mono text-xs" style={{ color: "#10b981" }}>{lufsTarget}</span>
              </div>
              <input type="range" min={-20} max={-6} value={lufsTarget} onChange={(e) => setLufsTarget(+e.target.value)} className="w-full cursor-pointer accent-emerald-500" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted">Tolerancia</span>
                <span className="font-mono text-xs" style={{ color: "#10b981" }}>± {lufsTolerance}</span>
              </div>
              <input type="range" min={0.5} max={4} step={0.5} value={lufsTolerance} onChange={(e) => setLufsTolerance(+e.target.value)} className="w-full cursor-pointer accent-emerald-500" />
            </div>
          </div>
        </div>

        {/* Duration Range */}
        <div className="rounded-xl border p-5" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium">Duración máxima</label>
              <button onClick={() => setDurationEnabled((p) => !p)} className="relative w-9 h-5 rounded-full transition-colors cursor-pointer" style={{ background: durationEnabled ? "#10b981" : "#27272a" }}>
                <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform" style={{ left: durationEnabled ? "calc(100% - 18px)" : "2px" }} />
              </button>
            </div>
            {durationEnabled && <span className="font-mono text-xs px-2 py-1 rounded-lg" style={{ background: "#111114" }}>{Math.floor(durationMax / 60)}:{String(durationMax % 60).padStart(2, "0")}</span>}
          </div>
          {durationEnabled && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted">Máximo</span>
                <span className="font-mono text-xs" style={{ color: "#10b981" }}>{Math.floor(durationMax / 60)}:{String(durationMax % 60).padStart(2, "0")}</span>
              </div>
              <input type="range" min={0} max={1200} step={30} value={durationMax} onChange={(e) => setDurationMax(+e.target.value)} className="w-full cursor-pointer accent-emerald-500" />
              <div className="flex justify-between text-[10px] font-mono text-muted mt-1"><span>0:00</span><span>20:00</span></div>
            </div>
          )}
        </div>

        {/* Preferred Scales */}
        <div className="rounded-xl border p-5" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
          <label className="text-sm font-medium mb-3 block">Escala preferida</label>
          <div className="flex gap-2 flex-wrap">
            {scales.map((s) => (
              <button
                key={s}
                onClick={() => toggleScale(s)}
                className="text-xs px-3 py-1.5 rounded-lg border transition-all active:scale-95"
                style={{
                  borderColor: selectedScales.includes(s) ? "#10b981" : "#27272a",
                  color: selectedScales.includes(s) ? "#10b981" : "#71717a",
                  background: selectedScales.includes(s) ? "rgba(16,185,129,0.1)" : "transparent",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Auto-Reject Rules */}
        <div className="rounded-xl border p-5" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
          <label className="text-sm font-medium mb-3 block">Rechazo automático</label>
          <div className="flex gap-2 flex-wrap">
            {[
              { key: "phase" as const, label: "Fase invertida" },
              { key: "lufs" as const, label: "LUFS > -8" },
              { key: "tempo" as const, label: "Fuera de tempo" },
            ].map((rule) => (
              <button
                key={rule.key}
                onClick={() => setAutoReject((prev) => ({ ...prev, [rule.key]: !prev[rule.key] }))}
                className="text-xs px-3 py-1.5 rounded-lg border transition-all active:scale-95"
                style={{
                  borderColor: autoReject[rule.key] ? "#ef4444" : "#27272a",
                  color: autoReject[rule.key] ? "#ef4444" : "#71717a",
                  background: autoReject[rule.key] ? "rgba(239,68,68,0.1)" : "transparent",
                }}
              >
                {rule.label}
              </button>
            ))}
          </div>
        </div>

        {/* Save Button */}
        <div className="pt-6 border-t" style={{ borderColor: "#27272a" }}>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 text-sm font-medium rounded transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "#10b981", color: "#09090b" }}
            >
              {saving ? "Guardando..." : "Guardar firma sónica"}
            </button>
            {saved && (
              <span className="text-sm font-mono" style={{ color: "#10b981" }}>✓ Guardado</span>
            )}
            {saveError && (
              <span className="text-sm" style={{ color: "#ef4444" }}>Error: {saveError}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

