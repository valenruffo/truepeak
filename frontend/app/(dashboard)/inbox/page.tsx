"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type FilterStatus = "all" | "pending" | "approved" | "rejected";

const DEMOS = [
  { id: 1, name: "Mara — Deep Cut", producer: "Mara Beats", bpm: "122", lufs: "-14.0", phase: "OK", key: "Am", status: "pending" as const, time: "Hace 3 min" },
  { id: 2, name: "Subsonic — Pulse", producer: "Subsonic", bpm: "126", lufs: "-12.8", phase: "OK", key: "Fm", status: "pending" as const, time: "Hace 12 min" },
  { id: 3, name: "DJ Krill — Midnight", producer: "DJ Krill", bpm: "128", lufs: "-6.2", phase: "INV", key: "Cm", status: "rejected" as const, time: "Hace 18 min", issue: "Fase + LUFS" },
  { id: 4, name: "Anon — Groove 03", producer: "Anon", bpm: "118", lufs: "-14.3", phase: "OK", key: "Dm", status: "rejected" as const, time: "Hace 24 min", issue: "Fuera de tempo" },
  { id: 5, name: "Kael — Drift", producer: "Kael", bpm: "124", lufs: "-13.5", phase: "OK", key: "Em", status: "approved" as const, time: "Ayer" },
  { id: 6, name: "Vex — Hollow", producer: "Vex", bpm: "123", lufs: "-13.8", phase: "OK", key: "Bbm", status: "approved" as const, time: "Ayer" },
];

const FILTER_TABS: { key: FilterStatus; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "pending", label: "Pendientes" },
  { key: "approved", label: "Aprobados" },
  { key: "rejected", label: "Rechazados" },
];

export default function InboxPage() {
  const [filter, setFilter] = useState<FilterStatus>("all");

  const filtered = DEMOS.filter((d) => filter === "all" || d.status === filter);
  const pendingCount = DEMOS.filter((d) => d.status === "pending").length;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
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
      <div className="mb-6 flex gap-1">
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
        {filtered.map((d) => (
          <div
            key={d.id}
            className="grid grid-cols-12 gap-2 px-4 py-3 text-xs items-center border-b transition-colors hover:bg-surface"
            style={{
              borderColor: "#1a1a1e",
              background: d.status === "pending" ? "rgba(6,182,212,0.04)" : "transparent",
            }}
          >
            <div className="col-span-4">
              <div className="font-medium">{d.name}</div>
              <div className="text-[10px] text-muted">{d.producer} · {d.time}</div>
            </div>
            <div className="col-span-1 text-center font-mono">{d.bpm}</div>
            <div className="col-span-1 text-center font-mono">{d.lufs}</div>
            <div className="col-span-1 text-center font-mono" style={{ color: d.phase === "INV" ? "#ef4444" : "#10b981" }}>{d.phase}</div>
            <div className="col-span-1 text-center font-mono text-muted">{d.key}</div>
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
            <div className="col-span-2 text-right">
              {d.status === "pending" && (
                <div className="flex items-center justify-end gap-1">
                  <button className="px-3 py-1 rounded text-[10px] font-medium" style={{ background: "#10b981", color: "#09090b" }}>Escuchar</button>
                  <button className="px-3 py-1 rounded text-[10px] border" style={{ borderColor: "#27272a", color: "#71717a" }}>Descartar</button>
                </div>
              )}
              {d.status === "rejected" && (
                <span className="text-[10px] text-muted">{d.issue}</span>
              )}
              {d.status === "approved" && (
                <span className="text-[10px] text-muted">En cola</span>
              )}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="py-12 text-center text-muted">
            No hay demos en esta categoría.
          </div>
        )}
      </div>
    </div>
  );
}
