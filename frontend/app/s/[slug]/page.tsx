"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams } from "next/navigation";
import { useLanguage } from "@/lib/i18n";

// ──────────────────────────────────────────────────────────────────────────────
// Three-phase upload helpers (Phase 3 of upload-progress-improvement)
//
//   Phase 1 → POST /api/presigned-url      (gets upload_url, r2_key, submission_id)
//   Phase 2 → XHR PUT directly to R2        (real 0..50% progress from the browser)
//   Phase 3 → POST /api/analyze + SSE       (50..100% from the backend pipeline)
//
// If phase 1 or phase 2 fails (CORS, network, R2 misconfig) the legacy
// `POST /api/upload` FormData flow is used instead. The legacy path is
// kept fully working; the new path is purely additive.
// ──────────────────────────────────────────────────────────────────────────────

type ThreePhaseArgs = {
  file: File;
  slug: string;
  producerName: string;
  producerEmail: string;
  trackName: string;
  notes: string;
  producerInstagram: string;
  producerSoundcloud: string;
  producerSpotify: string;
  onUploadProgress: (pct: number) => void;
  onAnalyzeProgress: (pct: number) => void;
  onError: (err: Error) => void;
};

type LegacyFlowArgs = {
  file: File;
  slug: string;
  producerName: string;
  producerEmail: string;
  trackName: string;
  notes: string;
  producerInstagram: string;
  producerSoundcloud: string;
  producerSpotify: string;
  onAnalyzeProgress: (pct: number) => void;
  // Animation hooks: the legacy flow does not own the requestAnimationFrame
  // loop, but it does own its progress ticks. We pass the caller's helpers
  // so the bar keeps moving smoothly during the simulated 0→50 phase.
  animate: () => void;
  animFrame: number;
  setProgress: (n: number) => void;
  isDone: () => boolean;
  markDone: () => void;
};

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL || "";
}

function isTransientUploadError(err: unknown): boolean {
  // We fall back to the legacy endpoint on anything that prevents the direct
  // PUT to R2. This includes CORS, network drops, and 5xx from R2.
  // We do NOT fall back on user-fixable issues like 413/415.
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    if (m.includes("413") || m.includes("415") || m.includes("payload too large") || m.includes("unsupported media")) {
      return false;
    }
  }
  return true;
}

async function runThreePhaseFlow(args: ThreePhaseArgs): Promise<void> {
  const {
    file,
    slug,
    producerName,
    producerEmail,
    trackName,
    notes,
    producerInstagram,
    producerSoundcloud,
    producerSpotify,
    onUploadProgress,
    onAnalyzeProgress,
    onError,
  } = args;

  // ── Phase 1: request presigned URL ────────────────────────────────────────
  const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
  const contentType = file.type || "application/octet-stream";

  let presigned: {
    upload_url: string;
    r2_key: string;
    submission_id: string;
  };

  try {
    const presignedRes = await fetch(`${apiBase()}/api/presigned-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label_slug: slug,
        filename: file.name,
        content_type: contentType,
        file_size: file.size,
      }),
    });
    if (!presignedRes.ok) {
      const errBody = await presignedRes.json().catch(() => ({ detail: "" }));
      // Validation errors (size limit, format) should bubble up — do NOT
      // fall back, the legacy endpoint will reject them too.
      throw new Error(errBody.detail || `presigned-url: HTTP ${presignedRes.status}`);
    }
    presigned = await presignedRes.json();
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  // ── Phase 2: XHR PUT directly to R2 with real progress ───────────────────
  try {
    await xhrPutWithProgress(presigned.upload_url, file, contentType, onUploadProgress);
  } catch (err) {
    if (isTransientUploadError(err)) {
      onError(err instanceof Error ? err : new Error(String(err)));
    } else {
      // User-fixable error (e.g. file too large, wrong type). Reject outright.
      throw err;
    }
    return;
  }

  // ── Phase 3: trigger analysis and stream SSE ─────────────────────────────
  await runAnalyzeSse({
    r2_key: presigned.r2_key,
    submission_id: presigned.submission_id,
    slug,
    producerName,
    producerEmail,
    trackName,
    notes,
    producerInstagram,
    producerSoundcloud,
    producerSpotify,
    onProgress: onAnalyzeProgress,
  });
}

function xhrPutWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        const pct = Math.round((evt.loaded / evt.total) * 100);
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`R2 PUT failed: HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error uploading to R2"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));

    xhr.send(file);
  });
}

type AnalyzeSseArgs = {
  r2_key: string;
  submission_id: string;
  slug: string;
  producerName: string;
  producerEmail: string;
  trackName: string;
  notes: string;
  producerInstagram: string;
  producerSoundcloud: string;
  producerSpotify: string;
  onProgress: (pct: number) => void;
};

async function runAnalyzeSse(args: AnalyzeSseArgs): Promise<void> {
  const {
    r2_key,
    submission_id,
    slug,
    producerName,
    producerEmail,
    trackName,
    notes,
    producerInstagram,
    producerSoundcloud,
    producerSpotify,
    onProgress,
  } = args;

  const response = await fetch(`${apiBase()}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      r2_key,
      submission_id,
      label_slug: slug,
      producer_name: producerName,
      producer_email: producerEmail,
      track_name: trackName,
      notes,
      producer_instagram: producerInstagram,
      producer_soundcloud: producerSoundcloud,
      producer_spotify: producerSpotify,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: "" }));
    throw new Error(err.detail || `analyze: HTTP ${response.status}`);
  }
  if (!response.body) throw new Error("No response body from /api/analyze");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done: streamDone, value } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.error) throw new Error(event.error);
        if (event.done) return;
        if (typeof event.pct === "number") onProgress(event.pct);
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message) {
          // Re-throw SSE error messages but ignore JSON.parse noise.
          if (parseErr.message !== "Unexpected token" && parseErr.message !== line) {
            throw parseErr;
          }
        }
      }
    }
  }
}

async function runLegacyFlow(args: LegacyFlowArgs): Promise<void> {
  const {
    file,
    slug,
    producerName,
    producerEmail,
    trackName,
    notes,
    producerInstagram,
    producerSoundcloud,
    producerSpotify,
    onAnalyzeProgress,
  } = args;

  // Simulated 0..50 progress during the legacy multipart upload. The
  // animation loop the caller set up will smooth this out, so we just
  // bump the target a few times.
  const simTimer = setInterval(() => {
    if (args.isDone()) {
      clearInterval(simTimer);
      return;
    }
  }, 200);

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

    const response = await fetch(`${apiBase()}/api/upload`, {
      method: "POST",
      body: formData,
    });
    clearInterval(simTimer);

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: "" }));
      throw new Error(err.detail || `upload: HTTP ${response.status}`);
    }
    if (!response.body) throw new Error("No response body from /api/upload");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.error) throw new Error(event.error);
          if (event.done) return;
          if (typeof event.pct === "number") onAnalyzeProgress(event.pct);
        } catch (parseErr) {
          if (parseErr instanceof Error && parseErr.message) {
            if (parseErr.message !== "Unexpected token" && parseErr.message !== line) {
              throw parseErr;
            }
          }
        }
      }
    }
  } catch (err) {
    clearInterval(simTimer);
    throw err;
  }
}

export default function SubmissionPage() {
  const { t } = useLanguage();
  const params = useParams();
  const slug = params.slug as string;

  const [labelName, setLabelName] = useState<string | null>(null);
  const [labelLogo, setLabelLogo] = useState<string | null>(null);
  const [submissionTitle, setSubmissionTitle] = useState(t("submission.default_title"));
  const [submissionDescription, setSubmissionDescription] = useState(
    t("submission.default_description")
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
      setError(t("submission.error_ext").replace("{formats}", allowedStr));
      return;
    }
    if (f.size > maxUploadSizeMb * 1024 * 1024) {
      setError(t("submission.error_size").replace("{size}", String(maxUploadSizeMb)));
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
    setError("");
    setAnalyzing(false);

    // Smooth animation that always pushes the bar toward `targetPct`.
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

    const finishWithError = (msg: string) => {
      done = true;
      cancelAnimationFrame(animFrame);
      setUploading(false);
      setAnalyzing(false);
      setError(msg);
    };

    const finishWithSuccess = () => {
      targetPct = 100;
      setTimeout(() => {
        done = true;
        cancelAnimationFrame(animFrame);
        setProgress(100);
        setAnalyzing(false);
        setTimeout(() => setUploading(false), 400);
        setSubmitted(true);
      }, 600);
    };

    try {
      // Try the 3-phase flow (presigned URL → direct R2 upload → analyze SSE).
      // Falls back to legacy /api/upload on any failure.
      await runThreePhaseFlow({
        file,
        slug,
        producerName,
        producerEmail,
        trackName,
        notes,
        producerInstagram,
        producerSoundcloud,
        producerSpotify,
        onUploadProgress: (pct) => {
          // Direct R2 PUT progress is 0..50 of the overall bar.
          const overall = Math.max(1, Math.min(50, Math.round(pct * 0.5)));
          if (overall > targetPct) targetPct = overall;
        },
        onAnalyzeProgress: (pct) => {
          setAnalyzing(true);
          if (pct > targetPct) targetPct = pct;
        },
        onError: (err) => {
          // Phase 1 or Phase 2 failed — fall back to legacy multipart flow.
          // We surface the original error to the console for diagnostics,
          // then transparently retry via /api/upload.
          // eslint-disable-next-line no-console
          console.warn(
            "[upload-progress-improvement] Direct R2 upload failed, falling back to legacy /api/upload:",
            err?.message || err
          );
          runLegacyFlow({
            file,
            slug,
            producerName,
            producerEmail,
            trackName,
            notes,
            producerInstagram,
            producerSoundcloud,
            producerSpotify,
            onAnalyzeProgress: (pct) => {
              setAnalyzing(true);
              if (pct > targetPct) targetPct = pct;
            },
            animate,
            animFrame,
            setProgress,
            isDone: () => done,
            markDone: () => {
              done = true;
              cancelAnimationFrame(animFrame);
            },
          })
            .then(finishWithSuccess)
            .catch((fallbackErr) => {
              finishWithError(
                fallbackErr instanceof Error
                  ? fallbackErr.message
                  : t("submission.error_upload")
              );
            });
        },
      })
        .then(finishWithSuccess)
        .catch((err) => {
          // Should not normally hit this — runThreePhaseFlow resolves on
          // success and on graceful fallback. Kept as a safety net.
          if (err instanceof Error) {
            finishWithError(err.message);
          } else {
            finishWithError(t("submission.error_upload"));
          }
        });
    } catch (err) {
      finishWithError(
        err instanceof Error ? err.message : t("submission.error_upload")
      );
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
          <h1 className="font-display font-bold text-2xl mb-3">{t("submission.frozen_title")}</h1>
          <p className="text-muted mb-6" dangerouslySetInnerHTML={{ __html: t("submission.frozen_desc").replace("{label_name}", labelName || slug) }} />
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
          <h1 className="font-display font-bold text-2xl mb-3">{t("submission.success_title")}</h1>
          <p className="text-muted mb-6" dangerouslySetInnerHTML={{ __html: t("submission.success_desc").replace("{track_name}", trackName) }} />
          <button
            onClick={() => { setSubmitted(false); setFile(null); setProducerName(""); setProducerEmail(""); setTrackName(""); setNotes(""); }}
            className="px-6 py-2.5 text-sm font-medium rounded"
            style={{ background: "#10b981", color: "#09090b" }}
          >
            {t("submission.send_another")}
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
              {labelLoading ? t("submission.loading") : labelError ? slug : labelName}
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
              <label className="text-sm font-medium mb-1.5 block">{t("submission.label_name")}</label>
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
              <label className="text-sm font-medium mb-1.5 block">{t("submission.label_email")}</label>
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
                <label className="text-sm font-medium mb-1.5 block">{t("submission.label_instagram")}</label>
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
                <label className="text-sm font-medium mb-1.5 block">{t("submission.label_soundcloud")}</label>
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
                <label className="text-sm font-medium mb-1.5 block">{t("submission.label_spotify")}</label>
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
              <label className="text-sm font-medium mb-1.5 block">{t("submission.label_track")}</label>
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
              <label className="text-sm font-medium mb-1.5 block">{t("submission.label_audio")}</label>
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
                    <div className="text-sm mb-1">{t("submission.drag_audio")}</div>
                    <div className="text-xs text-muted">{t("submission.or_click")} · Max {maxUploadSizeMb}MB ({allowedFormats.map(f => f.toUpperCase()).join(", ")})</div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">{t("submission.label_notes")}</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2.5 rounded border text-sm bg-transparent"
                style={{ borderColor: "#27272a" }}
                placeholder={t("submission.notes_placeholder")}
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
                        {t("submission.analyzing")}
                      </span>
                    ) : (
                      t("submission.uploading")
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
              {analyzing ? t("submission.submitting").replace("{progress}", String(progress)) : uploading ? t("submission.uploading_btn") : t("submission.submit")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}


