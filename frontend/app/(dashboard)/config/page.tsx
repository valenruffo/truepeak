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
  duration_min?: number;
  duration_max?: number;
  auto_reject_rules: {
    phase: boolean;
    lufs: boolean;
    tempo: boolean;
  };
}

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
  const [durationRange, setDurationRange] = useState([60, 600]); // 1min - 10min in seconds

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
          if (sig.duration_min && sig.duration_max) {
            setDurationRange([sig.duration_min, sig.duration_max]);
          }
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
            duration_min: durationEnabled ? durationRange[0] : null,
            duration_max: durationEnabled ? durationRange[1] : null,
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

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Configuración</div>
      <h1 className="font-display font-semibold text-2xl mb-8">Firma sónica — Sello principal</h1>

      <div className="space-y-8">
        {/* Logo Upload */}
        <div>
          <label className="text-sm font-medium mb-1 block">Logo del sello</label>
          <p className="text-xs text-muted mb-3">
            Subí el logo de tu sello. Se mostrará en la página de recepción de demos.
          </p>
          {logoUrl && !logoPreview && (
            <div className="mb-3">
              <img
                src={logoUrl}
                alt="Logo actual"
                className="w-16 h-16 rounded object-cover border"
                style={{ borderColor: "#27272a" }}
              />
            </div>
          )}
          <div
            onDragEnter={handleLogoDrag}
            onDragLeave={handleLogoDrag}
            onDragOver={handleLogoDrag}
            onDrop={handleLogoDrop}
            className="rounded border-2 border-dashed p-6 text-center cursor-pointer transition-colors"
            style={{
              borderColor: logoDragActive ? "#10b981" : logoPreview ? "#10b981" : "#27272a",
              background: logoDragActive ? "rgba(16,185,129,0.05)" : "transparent",
            }}
            onClick={() => document.getElementById("logo-input")?.click()}
          >
            <input
              id="logo-input"
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleLogoFile(e.target.files[0])}
            />
            {logoPreview ? (
              <div>
                <img
                  src={logoPreview}
                  alt="Preview"
                  className="w-16 h-16 rounded object-cover mx-auto mb-2 border"
                  style={{ borderColor: "#27272a" }}
                />
                <div className="text-sm font-medium mb-1" style={{ color: "#10b981" }}>
                  ✓ {logoFile?.name}
                </div>
                <div className="text-xs text-muted">
                  {(logoFile!.size / (1024 * 1024)).toFixed(1)} MB
                </div>
              </div>
            ) : (
              <div>
                <div className="text-sm mb-1">
                  {logoUrl ? "Cambiar logo" : "Arrastrá tu logo acá"}
                </div>
                <div className="text-xs text-muted">
                  o hacé clic para seleccionar · JPG, PNG, WebP · Max 5MB
                </div>
              </div>
            )}
          </div>
          {logoError && (
            <div className="mt-2 text-xs" style={{ color: "#ef4444" }}>{logoError}</div>
          )}
          {(logoPreview || logoUrl) && (
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={uploadLogo}
                disabled={logoUploading || !logoFile}
                className="px-4 py-2 text-xs font-medium rounded transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: "#10b981", color: "#09090b" }}
              >
                {logoUploading ? "Subiendo..." : logoUrl ? "Actualizar logo" : "Subir logo"}
              </button>
              {logoSaved && (
                <span className="text-xs font-mono" style={{ color: "#10b981" }}>✓ Guardado</span>
              )}
            </div>
          )}
        </div>

        {/* BPM Range */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium">Rango de BPM</label>
            <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: "#18181b" }}>
              {bpmRange[0]} — {bpmRange[1]}
            </span>
          </div>
          <div className="relative h-1.5 rounded-full" style={{ background: "#27272a" }}>
            <div
              className="absolute h-full rounded-full"
              style={{
                left: `${((bpmRange[0] - 60) / 140) * 100}%`,
                right: `${100 - ((bpmRange[1] - 60) / 140) * 100}%`,
                background: "#10b981",
              }}
            />
          </div>
          <div className="flex gap-4 mt-3">
            <div className="flex-1">
              <label className="text-xs text-muted mb-1 block">Mínimo</label>
              <input
                type="range"
                min={60}
                max={200}
                value={bpmRange[0]}
                onChange={(e) => setBpmRange([Math.min(+e.target.value, bpmRange[1] - 5), bpmRange[1]])}
                className="w-full"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted mb-1 block">Máximo</label>
              <input
                type="range"
                min={60}
                max={200}
                value={bpmRange[1]}
                onChange={(e) => setBpmRange([bpmRange[0], Math.max(+e.target.value, bpmRange[0] + 5)])}
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Duration Range */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Rango de duración</label>
              <button
                onClick={() => setDurationEnabled((p) => !p)}
                className="text-[10px] font-mono px-2 py-0.5 rounded border transition-colors"
                style={{
                  background: durationEnabled ? "rgba(16,185,129,0.15)" : "transparent",
                  color: durationEnabled ? "#10b981" : "#71717a",
                  borderColor: durationEnabled ? "rgba(16,185,129,0.3)" : "#27272a",
                }}
              >
                {durationEnabled ? "Activado" : "Desactivado"}
              </button>
            </div>
            {durationEnabled && (
              <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: "#18181b" }}>
                {Math.floor(durationRange[0] / 60)}:{String(durationRange[0] % 60).padStart(2, "0")} — {Math.floor(durationRange[1] / 60)}:{String(durationRange[1] % 60).padStart(2, "0")}
              </span>
            )}
          </div>
          {durationEnabled && (
            <>
              <div className="relative h-1.5 rounded-full" style={{ background: "#27272a" }}>
                <div
                  className="absolute h-full rounded-full"
                  style={{
                    left: `${(durationRange[0] / 1200) * 100}%`,
                    right: `${100 - (durationRange[1] / 1200) * 100}%`,
                    background: "#10b981",
                  }}
                />
              </div>
              <div className="flex gap-4 mt-3">
                <div className="flex-1">
                  <label className="text-xs text-muted mb-1 block">Mínimo</label>
                  <input
                    type="range"
                    min={0}
                    max={durationRange[1] - 30}
                    value={durationRange[0]}
                    onChange={(e) => setDurationRange([+e.target.value, durationRange[1]])}
                    className="w-full"
                  />
                  <span className="text-[10px] font-mono text-muted mt-0.5 block">
                    {Math.floor(durationRange[0] / 60)}:{String(durationRange[0] % 60).padStart(2, "0")}
                  </span>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-muted mb-1 block">Máximo</label>
                  <input
                    type="range"
                    min={durationRange[0] + 30}
                    max={1200}
                    value={durationRange[1]}
                    onChange={(e) => setDurationRange([durationRange[0], +e.target.value])}
                    className="w-full"
                  />
                  <span className="text-[10px] font-mono text-muted mt-0.5 block">
                    {Math.floor(durationRange[1] / 60)}:{String(durationRange[1] % 60).padStart(2, "0")}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* LUFS Target */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium">LUFS objetivo</label>
            <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: "#18181b" }}>
              {lufsTarget} ± {lufsTolerance}
            </span>
          </div>
          <div className="relative h-1.5 rounded-full" style={{ background: "#27272a" }}>
            <div
              className="absolute h-full rounded-full"
              style={{
                left: `${((lufsTarget - lufsTolerance + 20) / 20) * 100}%`,
                right: `${100 - ((lufsTarget + lufsTolerance + 20) / 20) * 100}%`,
                background: "#10b981",
              }}
            />
          </div>
          <div className="flex gap-4 mt-3">
            <div className="flex-1">
              <label className="text-xs text-muted mb-1 block">Target</label>
              <input
                type="range"
                min={-20}
                max={-6}
                value={lufsTarget}
                onChange={(e) => setLufsTarget(+e.target.value)}
                className="w-full"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted mb-1 block">Tolerancia</label>
              <input
                type="range"
                min={0.5}
                max={4}
                step={0.5}
                value={lufsTolerance}
                onChange={(e) => setLufsTolerance(+e.target.value)}
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Preferred Scales */}
        <div>
          <label className="text-sm font-medium mb-3 block">Escala preferida</label>
          <div className="flex gap-2 flex-wrap">
            {scales.map((s) => (
              <button
                key={s}
                onClick={() => toggleScale(s)}
                className="text-xs px-3 py-1.5 rounded border transition-colors"
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
        <div>
          <label className="text-sm font-medium mb-3 block">Rechazo automático</label>
          <div className="space-y-2">
            {[
              { key: "phase" as const, label: "Fase invertida" },
              { key: "lufs" as const, label: "LUFS > -8" },
              { key: "tempo" as const, label: "Fuera de tempo" },
            ].map((rule) => (
              <button
                key={rule.key}
                onClick={() => setAutoReject((prev) => ({ ...prev, [rule.key]: !prev[rule.key] }))}
                className="flex items-center gap-3 w-full text-left"
              >
                <div
                  className="w-4 h-4 rounded-sm flex items-center justify-center transition-colors"
                  style={{ background: autoReject[rule.key] ? "#10b981" : "#27272a" }}
                >
                  {autoReject[rule.key] && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#09090b" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <span className="text-sm text-muted">{rule.label}</span>
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
