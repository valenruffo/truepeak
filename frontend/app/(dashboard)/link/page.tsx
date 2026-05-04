"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const LABEL_SLUG = "nocturnal-records";
const SUBMISSION_URL = `https://truepeak.ai/s/${LABEL_SLUG}`;

export default function LinkPage() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(SUBMISSION_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Tu link de recepción</div>
      <h1 className="font-display font-semibold text-2xl mb-6">Compartí este link con productores</h1>

      <div className="flex items-center gap-2 mb-4">
        <div
          className="flex-1 px-4 py-3 rounded border font-mono text-sm"
          style={{ borderColor: "#27272a", background: "#111114" }}
        >
          {SUBMISSION_URL}
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
            <span className="font-display font-semibold text-sm">Nocturnal Records</span>
          </div>
          <p className="text-sm text-muted mb-4">
            Subí tu demo. Analizamos BPM, LUFS, fase y headroom antes de que el sello lo escuche.
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
          { label: "Total", value: "24" },
          { label: "Pendientes", value: "3" },
          { label: "Aprobados", value: "12" },
          { label: "Rechazados", value: "9" },
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
