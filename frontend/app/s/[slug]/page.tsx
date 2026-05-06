"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams } from "next/navigation";

export default function SubmissionPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [labelName, setLabelName] = useState<string | null>(null);
  const [labelLogo, setLabelLogo] = useState<string | null>(null);
  const [submissionTitle, setSubmissionTitle] = useState("Enviar demo");
  const [submissionDescription, setSubmissionDescription] = useState(
    "Subí tu WAV. Analizamos BPM, LUFS, fase y headroom antes de que el sello lo escuche."
  );
  const [labelLoading, setLabelLoading] = useState(true);
  const [labelError, setLabelError] = useState(false);

  useEffect(() => {
    const fetchLabel = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/labels/${slug}`);
        if (res.ok) {
          const data = await res.json();
          setLabelName(data.name);
          if (data.logo_path) {
            setLabelLogo(`${process.env.NEXT_PUBLIC_API_URL}/logos/${data.logo_path}`);
          }
          if (data.submission_title) setSubmissionTitle(data.submission_title);
          if (data.submission_description) setSubmissionDescription(data.submission_description);
        } else {
          setLabelError(true);
        }
      } catch {
        setLabelError(true);
      } finally {
        setLabelLoading(false);
      }
    };
    fetchLabel();
  }, [slug]);

  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [producerName, setProducerName] = useState("");
  const [producerEmail, setProducerEmail] = useState("");
  const [trackName, setTrackName] = useState("");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
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
    const validExts = [".wav", ".flac", ".aiff", ".aif"];
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    if (!validExts.includes(ext)) {
      setError("Solo se aceptan archivos WAV, FLAC o AIFF");
      return;
    }
    if (f.size > 100 * 1024 * 1024) {
      setError("El archivo no puede superar los 100MB");
      return;
    }
    setError("");
    setFile(f);
    if (!trackName) {
      setTrackName(f.name.replace(/\.[^.]+$/i, ""));
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
      formData.append("notes", notes);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${process.env.NEXT_PUBLIC_API_URL}/api/upload`);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const pct = Math.round((event.loaded / event.total) * 100);
          setProgress(pct);
          if (pct >= 100) {
            setAnalyzing(true);
          }
        }
      };

      xhr.onload = () => {
        setUploading(false);
        setAnalyzing(false);
        if (xhr.status === 200) {
          setSubmitted(true);
        } else {
          let serverMsg = "Error al subir el archivo. Intentá de nuevo.";
          try {
            const resp = JSON.parse(xhr.responseText);
            if (resp.detail) serverMsg = resp.detail;
          } catch {
            // fallback
          }
          setError(serverMsg);
        }
      };

      xhr.onerror = () => {
        setUploading(false);
        setAnalyzing(false);
        setError("Error de conexión. Verificá tu internet.");
      };

      xhr.send(formData);
    } catch {
      setUploading(false);
      setAnalyzing(false);
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
            onClick={() => { setSubmitted(false); setFile(null); setProducerName(""); setProducerEmail(""); setTrackName(""); setNotes(""); }}
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
            {labelLogo ? (
              <img src={labelLogo} alt="" className="w-8 h-8 rounded object-cover" />
            ) : (
              <div className="w-6 h-6 rounded" style={{ background: "#10b981" }} />
            )}
            <span className="font-display font-semibold text-lg">
              {labelLoading ? "Cargando..." : labelError ? slug : labelName}
            </span>
          </div>
          <h1 className="font-display font-bold text-xl mb-2">{submissionTitle}</h1>
          <p className="text-sm text-muted">
            {submissionDescription}
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
              <label className="text-sm font-medium mb-1.5 block">Archivo de audio</label>
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
                  accept=".wav,.flac,.aiff,.aif"
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
                    <div className="text-sm mb-1">Arrastrá tu audio acá</div>
                    <div className="text-xs text-muted">o hacé clic para seleccionar · Max 100MB</div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Observaciones adicionales (opcional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2.5 rounded border text-sm bg-transparent"
                style={{ borderColor: "#27272a" }}
                placeholder="Referencias, notas de producción, etc."
                rows={3}
                suppressHydrationWarning
              />
            </div>

            {uploading && (
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted">
                    {analyzing ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#10b981" }} />
                        Analizando audio...
                      </span>
                    ) : (
                      `Subiendo...`
                    )}
                  </span>
                  <span className="font-mono" style={{ color: "#10b981" }}>{analyzing ? "100%" : `${progress}%`}</span>
                </div>
                <div className="h-1.5 rounded-full" style={{ background: "#27272a" }}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${progress}%`,
                      background: "#10b981",
                      ...(analyzing ? { animation: "pulse 1.5s ease-in-out infinite" } : {}),
                    }}
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={uploading || !file || !producerName || !producerEmail || !trackName}
              suppressHydrationWarning
              className="w-full py-2.5 text-sm font-medium rounded transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "#10b981", color: "#09090b" }}
            >
              {analyzing ? "Analizando..." : uploading ? "Subiendo..." : "Enviar demo"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
