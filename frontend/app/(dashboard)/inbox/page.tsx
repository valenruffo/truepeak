"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { usePlayer } from "@/lib/PlayerContext";

type FilterStatus = "all" | "pending" | "approved" | "rejected";

interface Submission {
  id: string;
  producer_name: string;
  track_name: string;
  status: "pending" | "approved" | "rejected";
  bpm: number | null;
  lufs: number | null;
  phase_correlation: number | null;
  musical_key: string | null;
  created_at: string;
  mp3_path?: string | null;
  rejection_reason?: string | null;
}

interface SubmissionDetail extends Submission {
  label_id: string;
  producer_email: string;
}

const FILTER_TABS: { key: FilterStatus; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "pending", label: "Pendientes" },
  { key: "approved", label: "Aprobados" },
  { key: "rejected", label: "Rechazados" },
];

function formatRelativeTime(isoDate: string): string {
  const now = new Date();
  const date = new Date(isoDate);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "Ahora";
  if (diffMin < 60) return `Hace ${diffMin} min`;
  if (diffHr < 24) return `Hace ${diffHr}h`;
  if (diffDay === 1) return "Ayer";
  if (diffDay < 7) return `Hace ${diffDay}d`;
  return date.toLocaleDateString("es-AR");
}

function formatBpm(bpm: number | null): string {
  return bpm != null ? String(Math.round(bpm)) : "—";
}

function formatLufs(lufs: number | null): string {
  return lufs != null ? lufs.toFixed(1) : "—";
}

function formatPhase(phase: number | null): { text: string; color: string } {
  if (phase == null) return { text: "—", color: "#71717a" };
  return phase > 0
    ? { text: "OK", color: "#10b981" }
    : { text: "INV", color: "#ef4444" };
}

function formatKey(key: string | null): string {
  return key ?? "—";
}

export default function InboxPage() {
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [downloadableOnly, setDownloadableOnly] = useState(false);
  const searchParams = useSearchParams();
  const highlightParam = searchParams.get("highlight");
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { playTrack, isPlaying, currentTrack } = usePlayer();

  // Modal state
  const [modal, setModal] = useState<{
    open: boolean;
    detail: SubmissionDetail | null;
    loading: boolean;
    error: string | null;
  }>({ open: false, detail: null, loading: false, error: null });

  // Per-row action loading states
  const [actionLoading, setActionLoading] = useState<Record<string, "listen" | "approve" | "discard">>({});

  const API = process.env.NEXT_PUBLIC_API_URL;

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const token = localStorage.getItem("token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }, []);

  // Open listen modal
  const handleListen = async (id: string) => {
    setModal({ open: true, detail: null, loading: true, error: null });
    setActionLoading((prev) => ({ ...prev, [id]: "listen" }));
    try {
      const res = await fetch(`${API}/api/submissions/${id}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const detail: SubmissionDetail = await res.json();
      setModal({ open: true, detail, loading: false, error: null });
    } catch (e) {
      setModal({ open: true, detail: null, loading: false, error: e instanceof Error ? e.message : "Error desconocido" });
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  // Approve submission
  const handleApprove = async (id: string) => {
    setActionLoading((prev) => ({ ...prev, [id]: "approve" }));
    try {
      const res = await fetch(`${API}/api/submissions/${id}/status`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: "approved" }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const updated = await res.json();
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, status: "approved" as const, mp3_path: updated.mp3_path ?? s.mp3_path } : s
        )
      );
    } catch (e) {
      alert(`Error al aprobar: ${e instanceof Error ? e.message : "Error desconocido"}`);
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  // Discard (delete) submission
  const handleDiscard = async (id: string) => {
    setActionLoading((prev) => ({ ...prev, [id]: "discard" }));
    try {
      const res = await fetch(`${API}/api/submissions/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setSubmissions((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      alert(`Error al descartar: ${e instanceof Error ? e.message : "Error desconocido"}`);
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const closeModal = () => {
    setModal({ open: false, detail: null, loading: false, error: null });
  };

  useEffect(() => {
    const fetchSubmissions = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/submissions`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data: Submission[] = await res.json();
        setSubmissions(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error desconocido");
      } finally {
        setLoading(false);
      }
    };
    fetchSubmissions();
  }, []);

  const filtered = submissions
    .filter((d) => filter === "all" || d.status === filter)
    .filter((d) => !downloadableOnly || d.original_path);
  const pendingCount = submissions.filter((d) => d.status === "pending").length;

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <h1 className="font-display font-semibold text-xl">Bandeja de demos</h1>
        </div>
        <div className="rounded border overflow-hidden" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
          <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-muted border-b" style={{ borderColor: "#27272a" }}>
            <div className="col-span-4">Track</div>
            <div className="col-span-1 text-center">BPM</div>
            <div className="col-span-1 text-center">LUFS</div>
            <div className="col-span-1 text-center">Fase</div>
            <div className="col-span-1 text-center">Escala</div>
            <div className="col-span-2 text-center">Estado</div>
            <div className="col-span-2 text-right">Acción</div>
          </div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="grid grid-cols-12 gap-2 px-4 py-3 items-center border-b animate-pulse" style={{ borderColor: "#1a1a1e" }}>
              <div className="col-span-4">
                <div className="h-3 rounded w-32 mb-1" style={{ background: "#1a1a1e" }} />
                <div className="h-2 rounded w-20" style={{ background: "#1a1a1e" }} />
              </div>
              {[0, 1, 2, 3].map((j) => (
                <div key={j} className="col-span-1 text-center">
                  <div className="h-3 rounded w-8 mx-auto" style={{ background: "#1a1a1e" }} />
                </div>
              ))}
              <div className="col-span-2 text-center">
                <div className="h-4 rounded w-16 mx-auto" style={{ background: "#1a1a1e" }} />
              </div>
              <div className="col-span-2 text-right">
                <div className="h-5 rounded w-20 ml-auto" style={{ background: "#1a1a1e" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="font-display font-semibold text-xl mb-6">Bandeja de demos</h1>
        <div className="rounded border p-8 text-center" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
          <p className="text-sm" style={{ color: "#ef4444" }}>Error al cargar demos: {error}</p>
          <button
            onClick={() => { setLoading(true); setError(null); }}
            className="mt-4 px-4 py-2 rounded text-sm font-medium"
            style={{ background: "#10b981", color: "#09090b" }}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  // Scroll to highlighted submission from CRM link
  useEffect(() => {
    if (highlightParam && !loading) {
      const el = document.getElementById(`sub-${highlightParam}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [highlightParam, loading]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <style>{`
        @keyframes breathe {
          0%, 100% { box-shadow: 0 0 20px rgba(16,185,129,0.2), inset 0 0 20px rgba(16,185,129,0.06); }
          50% { box-shadow: 0 0 35px rgba(16,185,129,0.4), inset 0 0 35px rgba(16,185,129,0.15); }
        }
      `}</style>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="font-display font-semibold text-xl">Bandeja de demos</h1>
          {pendingCount > 0 && (
            <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}>
              {pendingCount} nuevos
            </span>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="mb-6 flex gap-1 items-center">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className="px-4 py-1.5 text-sm font-medium rounded transition-colors"
            style={{
              background: filter === tab.key ? "#18181b" : "transparent",
              color: filter === tab.key ? "#fafafa" : "#71717a",
              border: filter === tab.key ? "1px solid #27272a" : "1px solid transparent",
            }}
          >
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setDownloadableOnly((p) => !p)}
          className="px-3 py-1.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1.5"
          style={{
            background: downloadableOnly ? "rgba(16,185,129,0.12)" : "transparent",
            color: downloadableOnly ? "#10b981" : "#71717a",
            border: downloadableOnly ? "1px solid rgba(16,185,129,0.3)" : "1px solid transparent",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Descargables
        </button>
      </div>

      {/* Table */}
      <div className="rounded border overflow-hidden" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
        {/* Header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-muted border-b" style={{ borderColor: "#27272a" }}>
          <div className="col-span-4">Track</div>
          <div className="col-span-1 text-center">BPM</div>
          <div className="col-span-1 text-center">LUFS</div>
          <div className="col-span-1 text-center">Fase</div>
          <div className="col-span-1 text-center">Escala</div>
          <div className="col-span-2 text-center">Estado</div>
          <div className="col-span-2 text-right">Acción</div>
        </div>

        {/* Rows */}
        {filtered.length > 0 ? filtered.map((d) => {
          const phase = formatPhase(d.phase_correlation);
          const isHighlighted = highlightParam === d.id;
          return (
            <div
              key={d.id}
              id={`sub-${d.id}`}
              className="grid grid-cols-12 gap-2 px-4 py-3 text-xs items-center border-b transition-all duration-700"
              style={{
                borderColor: "#1a1a1e",
                background: isHighlighted
                  ? "rgba(16,185,129,0.12)"
                  : d.status === "pending"
                    ? "rgba(6,182,212,0.04)"
                    : "transparent",
                boxShadow: isHighlighted ? "0 0 20px rgba(16,185,129,0.2), inset 0 0 20px rgba(16,185,129,0.06)" : "none",
                animation: isHighlighted ? "breathe 1.5s ease-in-out 3" : "none",
              }}
            >
              <div className="col-span-4 flex items-center gap-2">
                {d.mp3_path && (
                  <button
                    onClick={(e) => { e.stopPropagation(); playTrack({ id: d.id, track_name: d.track_name || "Sin nombre", producer_name: d.producer_name || "Anónimo", mp3_path: d.mp3_path }); }}
                    className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-white/10"
                    title="Reproducir"
                    style={{ color: currentTrack?.id === d.id ? "#10b981" : "#a1a1aa" }}
                  >
                    {currentTrack?.id === d.id && isPlaying ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                    )}
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{d.track_name || "Sin nombre"}</div>
                  <div className="text-[10px] text-muted flex items-center gap-1.5">
                    <span>{d.producer_name || "Anónimo"} · {formatRelativeTime(d.created_at)}</span>
                    {d.producer_email && (
                      <Link
                        href={`/crm?highlight=${d.id}`}
                        className="hover:underline"
                        style={{ color: "#10b981" }}
                        title="Ver en CRM"
                      >
                        📧
                      </Link>
                    )}
                  </div>
                </div>
              </div>
              <div className="col-span-1 text-center font-mono">{formatBpm(d.bpm)}</div>
              <div className="col-span-1 text-center font-mono">{formatLufs(d.lufs)}</div>
              <div className="col-span-1 text-center font-mono" style={{ color: phase.color }}>{phase.text}</div>
              <div className="col-span-1 text-center font-mono text-muted">{formatKey(d.musical_key)}</div>
              <div className="col-span-2 text-center">
                {d.status === "pending" && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(6,182,212,0.15)", color: "#06b6d4" }}>Pendiente</span>
                )}
                {d.status === "approved" && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}>Aprobado</span>
                )}
                {d.status === "rejected" && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>Rechazado</span>
                )}
              </div>
              <div className="col-span-2 text-right flex items-center justify-end gap-1">
                {d.original_path && (
                  <a
                    href={d.original_path ? `${process.env.NEXT_PUBLIC_API_URL}/api/submissions/${d.id}/download` : "#"}
                    onClick={(e) => {
                      e.stopPropagation();
                      const token = localStorage.getItem("token");
                      if (!token) return;
                      // Download via fetch with auth header
                      fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/submissions/${d.id}/download`, {
                        headers: { Authorization: `Bearer ${token}` },
                      })
                        .then((res) => res.blob())
                        .then((blob) => {
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `${d.track_name || d.id}.wav`;
                          a.click();
                          URL.revokeObjectURL(url);
                        });
                    }}
                    className="px-2 py-1 rounded text-[10px] font-medium flex items-center gap-0.5 transition-colors hover:opacity-80"
                    style={{ background: "rgba(16,185,129,0.12)", color: "#10b981" }}
                    title="Descargar WAV original"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    WAV
                  </a>
                )}
                {d.status === "pending" && (
                  <>
                    <button
                      onClick={() => handleListen(d.id)}
                      disabled={!!actionLoading[d.id]}
                      className="px-3 py-1 rounded text-[10px] font-medium disabled:opacity-50"
                      style={{ background: "#10b981", color: "#09090b" }}
                    >
                      {actionLoading[d.id] === "listen" ? "..." : "Escuchar"}
                    </button>
                    <button
                      onClick={() => handleApprove(d.id)}
                      disabled={!!actionLoading[d.id]}
                      className="px-3 py-1 rounded text-[10px] font-medium disabled:opacity-50"
                      style={{ background: "#06b6d4", color: "#09090b" }}
                    >
                      {actionLoading[d.id] === "approve" ? "..." : "Aprobar"}
                    </button>
                    <button
                      onClick={() => handleDiscard(d.id)}
                      disabled={!!actionLoading[d.id]}
                      className="px-3 py-1 rounded text-[10px] border disabled:opacity-50"
                      style={{ borderColor: "#27272a", color: "#71717a" }}
                    >
                      {actionLoading[d.id] === "discard" ? "..." : "Descartar"}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        }) : (
          <div className="py-12 text-center text-muted">
            {filter === "all"
              ? "No hay demos todavía. Compartí tu link para empezar a recibir."
              : "No hay demos en esta categoría."}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {modal.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={closeModal}
        >
          <div
            className="rounded border max-w-lg w-full mx-4 overflow-hidden"
            style={{ borderColor: "#27272a", background: "#0c0c0e" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "#27272a" }}>
              <h2 className="font-display font-semibold text-base">Detalle del track</h2>
              <button
                onClick={closeModal}
                className="w-7 h-7 rounded flex items-center justify-center text-muted hover:text-white transition-colors"
                style={{ background: "#18181b" }}
              >
                ✕
              </button>
            </div>

            {/* Modal body */}
            <div className="px-5 py-4">
              {modal.loading && (
                <div className="py-8 text-center text-muted text-sm animate-pulse">Cargando detalles...</div>
              )}
              {modal.error && (
                <div className="py-8 text-center text-sm" style={{ color: "#ef4444" }}>
                  {modal.error}
                </div>
              )}
              {modal.detail && (
                <div className="space-y-4">
                  {/* Track info */}
                  <div>
                    <div className="font-medium text-sm">{modal.detail.track_name || "Sin nombre"}</div>
                    <div className="text-xs text-muted mt-0.5">{modal.detail.producer_name || "Anónimo"} · {modal.detail.producer_email || "Sin email"}</div>
                  </div>

                  {/* Specs grid */}
                  <div className="grid grid-cols-4 gap-2">
                    <div className="rounded px-3 py-2 text-center" style={{ background: "#18181b" }}>
                      <div className="text-[10px] text-muted uppercase tracking-wider">BPM</div>
                      <div className="font-mono text-sm mt-0.5">{formatBpm(modal.detail.bpm)}</div>
                    </div>
                    <div className="rounded px-3 py-2 text-center" style={{ background: "#18181b" }}>
                      <div className="text-[10px] text-muted uppercase tracking-wider">LUFS</div>
                      <div className="font-mono text-sm mt-0.5">{formatLufs(modal.detail.lufs)}</div>
                    </div>
                    <div className="rounded px-3 py-2 text-center" style={{ background: "#18181b" }}>
                      <div className="text-[10px] text-muted uppercase tracking-wider">Fase</div>
                      <div className="font-mono text-sm mt-0.5" style={{ color: formatPhase(modal.detail.phase_correlation).color }}>
                        {formatPhase(modal.detail.phase_correlation).text}
                      </div>
                    </div>
                    <div className="rounded px-3 py-2 text-center" style={{ background: "#18181b" }}>
                      <div className="text-[10px] text-muted uppercase tracking-wider">Escala</div>
                      <div className="font-mono text-sm mt-0.5">{formatKey(modal.detail.musical_key)}</div>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted">Estado:</span>
                    {modal.detail.status === "pending" && (
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(6,182,212,0.15)", color: "#06b6d4" }}>Pendiente</span>
                    )}
                    {modal.detail.status === "approved" && (
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}>Aprobado</span>
                    )}
                    {modal.detail.status === "rejected" && (
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>Rechazado</span>
                    )}
                    {modal.detail.rejection_reason && (
                      <span className="text-xs" style={{ color: "#ef4444" }}>— {modal.detail.rejection_reason}</span>
                    )}
                  </div>

                  {/* Audio player */}
                  {modal.detail.mp3_path ? (
                    <div>
                      <div className="text-xs text-muted mb-2">Preview de audio</div>
                      <audio controls className="w-full" src={`${API}/files/${modal.detail.mp3_path}`} style={{ borderRadius: "6px" }}>
                        Tu navegador no soporta audio.
                      </audio>
                    </div>
                  ) : (
                    <div className="rounded px-3 py-2 text-xs text-center" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                      Este track no tiene preview de audio todavía.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
