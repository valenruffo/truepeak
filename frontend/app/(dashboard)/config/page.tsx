"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export default function ConfigPage() {
  const [bpmRange, setBpmRange] = useState([120, 128]);
  const [lufsTarget, setLufsTarget] = useState(-14);
  const [lufsTolerance, setLufsTolerance] = useState(2);
  const [selectedScales, setSelectedScales] = useState(["Menor"]);
  const [autoReject, setAutoReject] = useState({
    phase: true,
    lufs: true,
    tempo: true,
  });

  const scales = ["Menor", "Mayor", "Dórica", "Frigia"];

  const toggleScale = (scale: string) => {
    setSelectedScales((prev) =>
      prev.includes(scale) ? prev.filter((s) => s !== scale) : [...prev, scale]
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Configuración</div>
      <h1 className="font-display font-semibold text-2xl mb-8">Firma sónica — Sello principal</h1>

      <div className="space-y-8">
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
          <button
            className="px-6 py-2.5 text-sm font-medium rounded transition-all hover:opacity-90"
            style={{ background: "#10b981", color: "#09090b" }}
          >
            Guardar firma sónica
          </button>
        </div>
      </div>
    </div>
  );
}
