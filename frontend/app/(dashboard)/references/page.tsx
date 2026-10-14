"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n";
import {
  getReferenceCatalog,
  getLabelDna,
  type LabelDnaReadiness,
  type ReferenceCatalogItem,
  type ReferenceStatus,
} from "@/lib/api";
import { ReferenceUploadDialog } from "@/components/dashboard/references/reference-upload-dialog";

const POLL_INTERVAL_MS = 5000;
const POLL_DEADLINE_MS = 120000;

const FingerprintIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="22" />
  </svg>
);

const STATUS_STYLE: Record<ReferenceStatus, { bg: string; color: string; pulse?: boolean }> = {
  uploaded: { bg: "rgba(161,161,170,0.12)", color: "#a1a1aa" },
  processing: { bg: "rgba(245,158,11,0.12)", color: "#f59e0b", pulse: true },
  ready: { bg: "rgba(16,185,129,0.12)", color: "#10b981" },
  failed: { bg: "rgba(239,68,68,0.12)", color: "#ef4444" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ReferencesPage() {
  const { t } = useLanguage();
  const [refs, setRefs] = useState<ReferenceCatalogItem[] | null>(null);
  const [dna, setDna] = useState<LabelDnaReadiness | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const catalog = await getReferenceCatalog();
      setRefs(catalog);
      setLoadError(false);
    } catch {
      setLoadError(true);
      setRefs((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    load();
    getLabelDna().then(setDna).catch(() => setDna(null));
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [load]);

  /** Poll the catalog every 5s (up to 120s) until this reference is ready/failed. */
  const pollForReference = useCallback(
    (referenceId: string) => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      const deadline = Date.now() + POLL_DEADLINE_MS;
      pollTimer.current = setInterval(async () => {
        if (Date.now() > deadline) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          return;
        }
        try {
          const catalog = await getReferenceCatalog();
          setRefs(catalog);
          const target = catalog.find((r) => r.id === referenceId);
          if (target && (target.status === "ready" || target.status === "failed")) {
            if (pollTimer.current) clearInterval(pollTimer.current);
            getLabelDna().then(setDna).catch(() => setDna(null));
          }
        } catch {
          /* transient poll errors: keep trying until deadline */
        }
      }, POLL_INTERVAL_MS);
    },
    []
  );

  const readyCount = refs?.filter((r) => r.status === "ready").length ?? 0;
  const isEmpty = refs != null && refs.length === 0 && !loadError;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FingerprintIcon size={22} />
            {t("references.title")}
            {refs != null && refs.length > 0 && (
              <span className="text-xs font-mono font-normal ml-1" style={{ color: "var(--text-muted)" }}>
                {t("references.count", { count: refs.length })}
              </span>
            )}
          </h1>
          <p className="text-sm mt-1 max-w-xl" style={{ color: "var(--text-muted)" }}>
            {t("references.subtitle")}
          </p>
        </div>
        {!isEmpty && (
          <button
            onClick={() => setUploadOpen(true)}
            className="rounded px-4 py-2 text-sm font-medium transition-colors hover:opacity-90 flex items-center gap-2"
            style={{ background: "#10b981", color: "#052e16" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            {t("references.upload")}
          </button>
        )}
      </div>

      {/* DNA readiness strip */}
      {dna && (
        <div
          className="rounded px-4 py-3 mb-6 text-sm flex items-center gap-2 flex-wrap"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
        >
          <span className="w-2 h-2 rounded-full" style={{ background: dna.eligible_count >= dna.minimum_valid_references ? "#10b981" : "#f59e0b" }} />
          <span style={{ color: "var(--text-secondary)" }}>
            {t("references.dna.progress", {
              active: dna.active_reference_count,
              eligible: dna.eligible_count,
              minimum: dna.minimum_valid_references,
            })}
          </span>
          {dna.eligible_count < dna.minimum_valid_references && (
            <span className="text-xs" style={{ color: "#f59e0b" }}>
              {t("references.dna.not_ready")}
            </span>
          )}
        </div>
      )}

      {/* Load error */}
      {loadError && (
        <div className="rounded px-4 py-3 mb-6 text-sm" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444" }}>
          {t("references.error_load")}{" "}
          <button onClick={load} className="underline font-medium">{t("references.dialog.retry")}</button>
        </div>
      )}

      {/* Empty state — sell the concept */}
      {isEmpty && (
        <div
          className="rounded-lg px-6 py-16 text-center"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
        >
          <div className="mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ background: "rgba(16,185,129,0.1)" }}>
            <FingerprintIcon size={26} />
          </div>
          <h2 className="text-lg font-semibold mb-2">{t("references.empty.title")}</h2>
          <p className="text-sm max-w-md mx-auto mb-6" style={{ color: "var(--text-muted)" }}>
            {t("references.empty.desc")}
          </p>
          <button
            onClick={() => setUploadOpen(true)}
            className="rounded px-5 py-2.5 text-sm font-medium transition-colors hover:opacity-90"
            style={{ background: "#10b981", color: "#052e16" }}
          >
            {t("references.empty.cta")}
          </button>
        </div>
      )}

      {/* Catalog grid */}
      {refs != null && refs.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {refs.map((ref) => {
            const style = STATUS_STYLE[ref.status] ?? STATUS_STYLE.uploaded;
            return (
              <div
                key={ref.id}
                className="rounded p-4 transition-colors"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate" title={ref.title}>{ref.title}</div>
                    {ref.artist && (
                      <div className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>{ref.artist}</div>
                    )}
                  </div>
                  <span
                    className={`font-mono text-[10px] px-2 py-0.5 rounded flex-shrink-0 ${style.pulse ? "animate-pulse" : ""}`}
                    style={{ background: style.bg, color: style.color }}
                  >
                    {t(("references.status." + ref.status) as Parameters<typeof t>[0])}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-3 text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
                  <span>{formatDate(ref.created_at)}</span>
                  {ref.duration_seconds != null && <span>{formatDuration(ref.duration_seconds)}</span>}
                </div>
                {ref.status === "processing" && (
                  <div className="flex items-center gap-1.5 mt-2 text-[11px]" style={{ color: "#f59e0b" }}>
                    <div className="w-3 h-3 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
                    {t("references.analyzing")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ReferenceUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onFinalized={(id) => {
          pollForReference(id);
        }}
      />
    </div>
  );
}
