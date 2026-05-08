"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

type LabelStats = { total: number; pending: number; approved: number; rejected: number };
type LabelInfo = { id: string; name: string; slug: string; owner_email: string; sonic_signature: string; created_at: string; submission_title?: string; submission_description?: string; plan?: string };
type Submission = { id: string; producer_name: string; producer_email: string | null; track_name: string; status: string; bpm: number | null; lufs: number | null; created_at: string; mp3_path?: string | null; notes?: string | null };

const LEMON_SQUEEZY_URL = "https://truepeak.lemonsqueezy.com/checkout/buy/xxx";

export default function LinkPage() {
  const [copied, setCopied] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [labelName, setLabelName] = useState<string>("");
  const [labelId, setLabelId] = useState<string>("");
  const [stats, setStats] = useState<LabelStats | null>(null);
  const [plan, setPlan] = useState<string>("free");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editable submission texts
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
        const res = await fetch(`/api/labels/${storedSlug}/stats`, {
          credentials: "include",
        });
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
        throw new Error(err.detail || "Error al guardar");
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
        <h1 className="font-display font-semibold text-2xl mb-4">Error</h1>
        <p className="text-sm text-muted">
          No se encontró tu sello. Iniciá sesión de nuevo.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Tu link de recepción</div>
        <h1 className="font-display font-semibold text-2xl mb-6">Cargando...</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-12 rounded" style={{ background: "#111114" }} />
          <div className="h-40 rounded" style={{ background: "#111114" }} />
          <div className="grid grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded" style={{ background: "#111114" }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const displayStats = stats ?? { total: 0, pending: 0, approved: 0, rejected: 0 };
  const isAtFreeLimit = plan === "free" && displayStats.total >= 5;

  // Hard block: show banner instead of link when free tier limit reached
  if (isAtFreeLimit) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Tu link de recepción</div>
        <h1 className="font-display font-semibold text-2xl mb-6">Compartí este link con productores</h1>

        {/* Red banner — hard block */}
        <div
          className="rounded border p-6 mb-8"
          style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)" }}
        >
          <div className="flex items-start gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" className="mt-0.5 flex-shrink-0">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <p className="text-sm font-medium mb-1" style={{ color: "#ef4444" }}>
                Límite alcanzado — 5/5 tracks procesados
              </p>
              <p className="text-sm text-muted mb-4">
                Hacé upgrade a Pro para seguir recibiendo demos.
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
          </div>
        </div>

        {/* Stats still visible */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total", value: String(displayStats.total) },
            { label: "Pendientes", value: String(displayStats.pending) },
            { label: "Aprobados", value: String(displayStats.approved) },
            { label: "Rechazados", value: String(displayStats.rejected) },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded border p-4 text-center"
              style={{ borderColor: "#27272a", background: "#111114" }}
            >
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
      <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Tu link de recepción</div>
      <h1 className="font-display font-semibold text-2xl mb-6">Compartí este link con productores</h1>

      <div className="flex items-center gap-2 mb-4">
        <div
          className="flex-1 px-4 py-3 rounded border font-mono text-sm"
          style={{ borderColor: "#27272a", background: "#111114" }}
        >
          {submissionUrl}
        </div>
        <button
          onClick={handleCopy}
          className="px-4 py-3 rounded text-sm font-medium transition-all hover:opacity-90"
          style={{ background: "#10b981", color: "#09090b" }}
        >
          {copied ? "✓ Copiado" : "Copiar"}
        </button>
      </div>

      <p className="text-sm text-muted mb-8">
        Los productores que entren por este link verán tu nombre de sello, tus requisitos técnicos y un formulario simple para subir su WAV.
      </p>

      {/* Preview */}
      <div className="rounded border p-6" style={{ borderColor: "#27272a", background: "#111114" }}>
        <div className="text-xs font-mono text-muted mb-4">Vista previa del link</div>
        <div className="rounded border p-4" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded" style={{ background: "#10b981" }} />
            <span className="font-display font-semibold text-sm">{labelName || slug}</span>
          </div>
          <p className="text-sm text-muted mb-4">
            {editDescription}
          </p>
          <div className="flex items-center gap-2">
            <div
              className="flex-1 h-10 rounded border flex items-center px-3"
              style={{ borderColor: "#27272a" }}
            >
              <span className="text-sm text-muted">Elegí tu archivo .wav…</span>
            </div>
            <button
              className="px-5 h-10 rounded text-sm font-medium"
              style={{ background: "#10b981", color: "#09090b" }}
            >
              Enviar
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-8 grid grid-cols-4 gap-4">
        {[
          { label: "Total", value: String(displayStats.total) },
          { label: "Pendientes", value: String(displayStats.pending) },
          { label: "Aprobados", value: String(displayStats.approved) },
          { label: "Rechazados", value: String(displayStats.rejected) },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded border p-4 text-center"
            style={{ borderColor: "#27272a", background: "#111114" }}
          >
            <div className="font-mono text-2xl font-bold">{stat.value}</div>
            <div className="text-xs text-muted mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Editable submission texts */}
      <div className="mt-8 rounded border p-6" style={{ borderColor: "#27272a", background: "#111114" }}>
        <div className="text-xs font-mono text-muted mb-4">Editar textos de tu página</div>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Título</label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full px-3 py-2.5 rounded border text-sm bg-transparent"
              style={{ borderColor: "#27272a" }}
              placeholder="Enviar demo"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Descripción</label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="w-full px-3 py-2.5 rounded border text-sm bg-transparent"
              style={{ borderColor: "#27272a" }}
              placeholder="Subí tu WAV. Analizamos BPM, LUFS, fase y headroom..."
              rows={3}
              suppressHydrationWarning
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveTexts}
              disabled={savingTexts}
              className="px-4 py-2 rounded text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "#10b981", color: "#09090b" }}
            >
              {savingTexts ? "Guardando..." : "Guardar textos"}
            </button>
            {textsSaved && <span className="text-xs" style={{ color: "#10b981" }}>✓ Guardado</span>}
            {textsError && <span className="text-xs" style={{ color: "#ef4444" }}>{textsError}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
