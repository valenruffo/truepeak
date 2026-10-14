"use client";

import { useCallback, useRef, useState } from "react";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/lib/i18n";
import {
  observeReferenceUpload,
  presignReferenceUpload,
  putFileToPresignedUrl,
  finalizeReferenceUpload,
  reserveReferenceUpload,
} from "@/lib/api";

type UploadStep = "idle" | "uploading" | "verifying" | "finalizing" | "done";

const MAX_WAV_BYTES = 100 * 1024 * 1024; // 100 MiB backend default limit

interface ReferenceUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once finalize succeeds; parent starts polling the catalog. */
  onFinalized: (referenceId: string) => void;
}

function isWav(file: File): boolean {
  return file.name.toLowerCase().endsWith(".wav");
}

export function ReferenceUploadDialog({
  open,
  onOpenChange,
  onFinalized,
}: ReferenceUploadDialogProps) {
  const { t } = useLanguage();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [step, setStep] = useState<UploadStep>("idle");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = step === "uploading" || step === "verifying" || step === "finalizing";

  const reset = useCallback(() => {
    setFile(null);
    setTitle("");
    setArtist("");
    setStep("idle");
    setPct(0);
    setError(null);
  }, []);

  const handleClose = (next: boolean) => {
    if (busy) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const startUpload = async () => {
    if (!file || !title.trim()) return;
    setError(null);
    setStep("uploading");
    setPct(0);
    try {
      const reservation = await reserveReferenceUpload({
        title: title.trim(),
        artist: artist.trim() || null,
        filename: file.name,
        sizeBytes: file.size,
        idempotencyKey: crypto.randomUUID(),
      });
      const presign = await presignReferenceUpload(reservation.reference_id);
      await putFileToPresignedUrl(presign.url, file, presign.required_headers, setPct);
      setStep("verifying");
      await observeReferenceUpload(reservation.reference_id);
      setStep("finalizing");
      const fin = await finalizeReferenceUpload(reservation.reference_id);
      setStep("done");
      onFinalized(fin.reference_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("references.dialog.error"));
      setStep("idle");
    }
  };

  const stepLabels: Record<Exclude<UploadStep, "idle">, string> = {
    uploading: t("references.dialog.step_uploading", { pct }),
    verifying: t("references.dialog.step_verifying"),
    finalizing: t("references.dialog.step_finalizing"),
    done: t("references.dialog.step_done"),
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogHeader>
        <DialogTitle style={{ color: "var(--text-primary)" }}>
          {t("references.upload")}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
        {/* File picker */}
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy || step === "done"}
          className="w-full rounded border border-dashed px-4 py-6 text-sm transition-colors hover:bg-white/5 disabled:opacity-60"
          style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
        >
          {file ? (
            <span>
              {t("references.dialog.selected")} <strong style={{ color: "#10b981" }}>{file.name}</strong>
              <span className="block text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {(file.size / (1024 * 1024)).toFixed(1)} MB
              </span>
            </span>
          ) : (
            <>
              <span style={{ color: "#10b981" }}>{t("references.dialog.pick")}</span>
              <span className="block text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {t("references.dialog.limits")}
              </span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".wav,audio/wav,audio/x-wav"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setError(null);
            if (f && !isWav(f)) {
              setError(t("references.dialog.limits"));
              return;
            }
            if (f && f.size > MAX_WAV_BYTES) {
              setError(t("references.dialog.limits"));
              return;
            }
            setFile(f);
            if (f && !title.trim()) {
              setTitle(f.name.replace(/\.wav$/i, ""));
            }
          }}
        />

        {/* Metadata */}
        <div className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("references.dialog.title_label")}
            disabled={busy || step === "done"}
            className="w-full rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500/50"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          />
          <input
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder={t("references.dialog.artist_label")}
            disabled={busy || step === "done"}
            className="w-full rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500/50"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          />
        </div>

        {/* Inline progress */}
        {step !== "idle" && (
          <div className="rounded px-3 py-2.5 text-sm" style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}>
            <div className="flex items-center gap-2">
              {step !== "done" ? (
                <div className="w-3.5 h-3.5 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin flex-shrink-0" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
              )}
              <span style={{ color: step === "done" ? "#10b981" : "var(--text-primary)" }}>
                {stepLabels[step]}
              </span>
            </div>
            {step === "done" && (
              <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {t("references.list.replaced_note")}
              </div>
            )}
            {step === "uploading" && (
              <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "#10b981" }} />
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="rounded px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444" }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={() => handleClose(false)}
            disabled={busy}
            className="rounded px-3 py-1.5 text-sm border transition-colors hover:bg-white/5 disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            {t("references.dialog.close")}
          </button>
          {step === "done" ? null : (
            <button
              onClick={startUpload}
              disabled={!file || !title.trim() || busy}
              className="rounded px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-40"
              style={{ background: "#10b981", color: "#052e16" }}
            >
              {error ? t("references.dialog.retry") : t("references.dialog.start")}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
