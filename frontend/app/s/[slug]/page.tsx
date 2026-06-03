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
  const [askInstagram, setAskInstagram] = useState(false);
  const [askSoundcloud, setAskSoundcloud] = useState(false);
  const [askSpotify, setAskSpotify] = useState(false);
  const [allowedFormats, setAllowedFormats] = useState<string[]>(["wav", "flac", "aiff"]);
  const [maxUploadSizeMb, setMaxUploadSizeMb] = useState<number>(100);
  const [labelLoading, setLabelLoading] = useState(true);
  const [labelError, setLabelError] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);

  useEffect(() => {
    const fetchLabel = async () => {
      try {
        const res = await fetch(`/api/labels/${slug}?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          setLabelName(data.name);
          if (data.logo_path) {
            // Support both absolute URLs (R2) and legacy relative paths
            setLabelLogo(data.logo_path.startsWith("http") || data.logo_path.startsWith("/") 
              ? data.logo_path 
              : `/logos/${data.logo_path}`);
          }
          if (data.submission_title) setSubmissionTitle(data.submission_title);
          if (data.submission_description) setSubmissionDescription(data.submission_description);
          setAskInstagram(!!data.ask_instagram);
          setAskSoundcloud(!!data.ask_soundcloud);
          setAskSpotify(!!data.ask_spotify);
          if (data.sonic_signature) {
            if (data.sonic_signature.allowed_formats) {
              setAllowedFormats(data.sonic_signature.allowed_formats);
            }
            if (data.sonic_signature.max_upload_size_mb) {
              setMaxUploadSizeMb(data.sonic_signature.max_upload_size_mb);
            }
          }
          if (data.subscription_status === "frozen") {
            setIsFrozen(true);
          }
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
  const [producerInstagram, setProducerInstagram] = useState("");
  const [producerSoundcloud, setProducerSoundcloud] = useState("");
  const [producerSpotify, setProducerSpotify] = useState("");
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
    const validExts = allowedFormats.flatMap((fmt) => {
      const lower = fmt.toLowerCase();
      if (lower === "wav") return [".wav"];
      if (lower === "flac") return [".flac"];
      if (lower === "aiff" || lower === "aif") return [".aiff", ".aif"];
      return [`.${lower}`];
    });
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    if (!validExts.includes(ext)) {
      const allowedStr = allowedFormats.map(fmt => fmt.toUpperCase()).join(", ");
      setError(`Solo se aceptan archivos ${allowedStr}`);
      return;
    }
    if (f.size > maxUploadSizeMb * 1024 * 1024) {
      setError(`El archivo no puede superar los ${maxUploadSizeMb}MB`);
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
    setAnalyzing(false);

    // Start smooth animation immediately for upload phase feedback
    let targetPct = 1;
    let currentPct = 0;
    let animFrame: number;
    let done = false;

    const animate = () => {
      if (done) return;
      if (currentPct < targetPct) {
        currentPct += Math.max(0.3, (targetPct - currentPct) * 0.08);
        if (currentPct > targetPct) currentPct = targetPct;
        setProgress(Math.round(currentPct));
      }
      animFrame = requestAnimationFrame(animate);
    };
    animFrame = requestAnimationFrame(animate);

    // Upload phase: slow, steady 0→50% — backend emits real SSE at each sub-step so the bar always advances
    const uploadTimer = setInterval(() => {
      if (targetPct < 50) {
        const step = 0.15 + Math.random() * 0.35;  // random 0.15-0.50 per tick
        targetPct = Math.min(50, targetPct + step);
      } else {
        clearInterval(uploadTimer);
      }
    }, 300);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("producer_name", producerName);
      formData.append("producer_email", producerEmail);
      formData.append("track_name", trackName);
      formData.append("label_slug", slug);
      formData.append("notes", notes);
      if (producerInstagram) formData.append("producer_instagram", producerInstagram);
      if (producerSoundcloud) formData.append("producer_soundcloud", producerSoundcloud);
      if (producerSpotify) formData.append("producer_spotify", producerSpotify);

      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "");
      const response = await fetch(`${apiUrl}/api/upload`, {
        method: "POST",
        body: formData,
      });

      clearInterval(uploadTimer);

      if (!response.ok) {
        done = true;
        cancelAnimationFrame(animFrame);
        const err = await response.json().catch(() => ({ detail: "Error desconocido" }));
        throw new Error(err.detail || `Error ${response.status}`);
      }

      // Read SSE stream for real-time progress
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let isAnalyzing = false;

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.error) {
                done = true;
                cancelAnimationFrame(animFrame);
                setError(event.error);
                setUploading(false);
                return;
              }
              if (event.done) {
                targetPct = 100;
                setTimeout(() => {
                  done = true;
                  cancelAnimationFrame(animFrame);
                  setProgress(100);
                  setAnalyzing(false);
                  setTimeout(() => setUploading(false), 400);
                  setSubmitted(true);
                }, 600);
                return;
              }
              if (event.pct != null) {
                targetPct = event.pct;
                if (!isAnalyzing) { isAnalyzing = true; setAnalyzing(true); }
              }
            } catch { /* skip malformed JSON */ }
          }
        }
      }

      done = true;
      cancelAnimationFrame(animFrame);
    } catch (err) {
      done = true;
      cancelAnimationFrame(animFrame);
      clearInterval(uploadTimer);
      setUploading(false);
      setAnalyzing(false);
      setError(err instanceof Error ? err.message : "Error al subir el archivo.");
    }
  };

  if (isFrozen) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#09090b" }}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center" style={{ background: "rgba(239,68,68,0.15)" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="font-display font-bold text-2xl mb-3">Link deshabilitado</h1>
          <p className="text-muted mb-6">
            El sello <strong style={{ color: "#fafafa" }}>{labelName || slug}</strong> actualmente no está recibiendo demos a través de este link.
          </p>
        </div>
      </div>
    );
  }

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

            {askInstagram && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">Instagram (opcional)</label>
                <div className="flex rounded border bg-transparent" style={{ borderColor: "#27272a" }}>
                  <span className="flex items-center justify-center px-3 bg-zinc-900/50 text-zinc-500 border-r border-zinc-800 text-sm select-none rounded-l">
                    @
                  </span>
                  <input
                    type="text"
                    value={producerInstagram}
                    onChange={(e) => {
                      const cleanVal = e.target.value.replace(/[@\s]/g, "");
                      setProducerInstagram(cleanVal);
                    }}
                    className="flex-1 px-3 py-2.5 bg-transparent border-0 outline-none text-sm rounded-r"
                    placeholder="djkrill"
                  />
                </div>
              </div>
            )}

            {askSoundcloud && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">SoundCloud (opcional)</label>
                <input
                  type="text"
                  value={producerSoundcloud}
                  onChange={(e) => setProducerSoundcloud(e.target.value)}
                  className="w-full px-3 py-2.5 rounded border text-sm bg-transparent"
                  style={{ borderColor: "#27272a" }}
                  placeholder="djkrill"
                />
              </div>
            )}

            {askSpotify && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">Spotify (opcional)</label>
                <input
                  type="text"
                  value={producerSpotify}
                  onChange={(e) => setProducerSpotify(e.target.value)}
                  className="w-full px-3 py-2.5 rounded border text-sm bg-transparent"
                  style={{ borderColor: "#27272a" }}
                  placeholder="open.spotify.com/artist/..."
                />
              </div>
            )}

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
                  accept={allowedFormats.map(fmt => {
                    if (fmt.toLowerCase() === "aiff") return ".aiff,.aif";
                    return `.${fmt.toLowerCase()}`;
                  }).join(",")}
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
                    <div className="text-xs text-muted">o hacé clic para seleccionar · Max {maxUploadSizeMb}MB ({allowedFormats.map(f => f.toUpperCase()).join(", ")})</div>
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
                  <span className="font-mono" style={{ color: "#10b981" }}>{progress}%</span>
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
              {analyzing ? `Analizando... ${progress}%` : uploading ? "Subiendo..." : "Enviar demo"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}


