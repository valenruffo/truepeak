"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";

export default function SubmissionPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [producerName, setProducerName] = useState("");
  const [producerEmail, setProducerEmail] = useState("");
  const [trackName, setTrackName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = e.dataTransfer.files;
    if (files && files[0]) {
      handleFile(files[0]);
    }
  }, []);

  const handleFile = (f: File) => {
    if (!f.name.toLowerCase().endsWith(".wav")) {
      setError("Solo se aceptan archivos WAV");
      return;
    }
    if (f.size > 100 * 1024 * 1024) {
      setError("El archivo no puede superar los 100MB");
      return;
    }
    setError("");
    setFile(f);
    if (!trackName) {
      setTrackName(f.name.replace(/\.wav$/i, ""));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !producerName || !producerEmail || !trackName) return;

    setUploading(true);
    setProgress(0);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("producer_name", producerName);
      formData.append("producer_email", producerEmail);
      formData.append("track_name", trackName);
      formData.append("label_slug", slug);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${process.env.NEXT_PUBLIC_API_URL}/api/upload`);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onload = () => {
        setUploading(false);
        if (xhr.status === 200) {
          setSubmitted(true);
        } else {
          setError("Error al subir el archivo. Intentá de nuevo.");
        }
      };

      xhr.onerror = () => {
        setUploading(false);
        setError("Error de conexión. Verificá tu internet.");
      };

      xhr.send(formData);
    } catch {
      setUploading(false);
      setError("Error al subir el archivo.");
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#09090b" }}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center" style={{ background: "rgba(16,185,129,0.15)" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="font-display font-bold text-2xl mb-3">Demo enviado</h1>
          <p className="text-muted mb-6">
            Tu track <strong style={{ color: "#fafafa" }}>{trackName}</strong> fue recibido y está siendo analizado.
            El sello te contactará si pasa el filtro técnico.
          </p>
          <button
            onClick={() => { setSubmitted(false); setFile(null); setProducerName(""); setProducerEmail(""); setTrackName(""); }}
            className="px-6 py-2.5 text-sm font-medium rounded"
            style={{ background: "#10b981", color: "#09090b" }}
          >
            Enviar otro demo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#09090b" }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-6 h-6 rounded" style={{ background: "#10b981" }} />
            <span className="font-display font-semibold text-lg">True Peak AI</span>
          </div>
          <h1 className="font-display font-bold text-xl mb-2">Enviar demo</h1>
          <p className="text-sm text-muted">
            Subí tu WAV. Analizamos BPM, LUFS, fase y headroom antes de que el sello lo escuche.
          </p>
        </div>

        <div className="rounded border p-6" style={{ borderColor: "#27272a", background: "#111114" }}>
          {error && (
            <div className="mb-4 px-4 py-3 rounded text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Tu nombre</label>
              <input
                type="text"
                value={producerName}
                onChange={(e) => setProducerName(e.target.value)}
                className="w-full px-3 py-2.5 rounded border text-sm bg-transparent"
                style={{ borderColor: "#27272a" }}
                placeholder="DJ Krill"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Email</label>
              <input
                type="email"
                value={producerEmail}
                onChange={(e) => setProducerEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded border text-sm bg-transparent"
                style={{ borderColor: "#27272a" }}
                placeholder="tu@email.com"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Nombre del track</label>
              <input
                type="text"
                value={trackName}
                onChange={(e) => setTrackName(e.target.value)}
                className="w-full px-3 py-2.5 rounded border text-sm bg-transparent"
                style={{ borderColor: "#27272a" }}
                placeholder="Midnight Protocol"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Archivo WAV</label>
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className="rounded border-2 border-dashed p-8 text-center cursor-pointer transition-colors"
                style={{
                  borderColor: dragActive ? "#10b981" : file ? "#10b981" : "#27272a",
                  background: dragActive ? "rgba(16,185,129,0.05)" : file ? "rgba(16,185,129,0.05)" : "transparent",
                }}
                onClick={() => document.getElementById("file-input")?.click()}
              >
                <input
                  id="file-input"
                  type="file"
                  accept=".wav"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
                {file ? (
                  <div>
                    <div className="text-sm font-medium mb-1" style={{ color: "#10b981" }}>✓ {file.name}</div>
                    <div className="text-xs text-muted">{(file.size / (1024 * 1024)).toFixed(1)} MB</div>
                  </div>
                ) : (
                  <div>
                    <div className="text-sm mb-1">Arrastrá tu WAV acá</div>
                    <div className="text-xs text-muted">o hacé clic para seleccionar · Max 100MB</div>
                  </div>
                )}
              </div>
            </div>

            {uploading && (
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted">Subiendo...</span>
                  <span className="font-mono" style={{ color: "#10b981" }}>{progress}%</span>
                </div>
                <div className="h-1.5 rounded-full" style={{ background: "#27272a" }}>
                  <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress}%`, background: "#10b981" }} />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={uploading || !file || !producerName || !producerEmail || !trackName}
              className="w-full py-2.5 text-sm font-medium rounded transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "#10b981", color: "#09090b" }}
            >
              {uploading ? "Subiendo..." : "Enviar demo"}
            </button>
          </form>
        </div>

        <div className="mt-6 text-center text-xs text-muted">
          Requisitos técnicos: WAV · BPM 120-128 · LUFS -14±2 · Fase correcta
        </div>
      </div>
    </div>
  );
}
