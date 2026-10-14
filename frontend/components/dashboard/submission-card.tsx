"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/lib/i18n";
import { createArDecision, type ArDecisionValue } from "@/lib/api";
import type { Submission } from "@/lib/api";

interface SubmissionCardProps {
  submission: Submission;
  onAccept?: (id: number) => void;
  onReject?: (id: number) => void;
  /** UUID used for A&R decision events; falls back to String(submission.id). */
  submissionId?: string;
  /** Called after a decision is recorded so the parent can refresh. */
  onDecided?: (decision: ArDecisionValue) => void;
}

export function SubmissionCard({
  submission,
  onAccept,
  onReject,
  submissionId,
  onDecided,
}: SubmissionCardProps) {
  const { t } = useLanguage();
  const [decisionState, setDecisionState] = useState<"idle" | "pending" | "recorded">("idle");

  const recordDecision = async (decision: ArDecisionValue) => {
    setDecisionState("pending"); // optimistic: hint shows immediately
    try {
      await createArDecision({
        submissionId: submissionId ?? String(submission.id),
        decision,
      });
      setDecisionState("recorded");
      onDecided?.(decision);
    } catch {
      setDecisionState("idle"); // revert on error
    }
  };

  const statusColor = {
    pending: "bg-yellow-500/20 text-yellow-400",
    accepted: "bg-accent/20 text-accent",
    rejected: "bg-red/20 text-red",
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{submission.track_title}</CardTitle>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[submission.status]}`}
          >
            {submission.status}
          </span>
        </div>
        <p className="text-sm text-muted">{submission.producer_name}</p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-4 text-xs font-mono">
          {submission.bpm && (
            <div>
              <span className="text-muted">BPM</span>
              <p className="text-foreground">{submission.bpm.toFixed(1)}</p>
            </div>
          )}
          {submission.lufs && (
            <div>
              <span className="text-muted">LUFS</span>
              <p className="text-foreground">{submission.lufs.toFixed(1)}</p>
            </div>
          )}
          {submission.true_peak && (
            <div>
              <span className="text-muted">Sample Peak (dBFS)</span>
              <p className="text-foreground">
                {(submission.true_peak > 0 ? (20 * Math.log10(submission.true_peak)).toFixed(1) : "-99.0")} dB
              </p>
            </div>
          )}
          {submission.musical_key && (
            <div>
              <span className="text-muted">Key</span>
              <p className="font-bold" style={{ color: "#10b981" }}>{submission.musical_key}</p>
            </div>
          )}
          {submission.duration && (
            <div>
              <span className="text-muted">Duration</span>
              <p className="text-foreground">
                {Math.floor(submission.duration / 60)}:
                {Math.floor(submission.duration % 60)
                  .toString()
                  .padStart(2, "0")}
              </p>
            </div>
          )}
        </div>
        <div className="mt-4 flex gap-2 items-center">
          {decisionState !== "idle" && (
            <span
              className="font-mono text-[10px] px-1.5 py-0.5 rounded mr-1"
              style={{ background: "rgba(16,185,129,0.1)", color: "#10b981", border: "1px solid rgba(16,185,129,0.25)" }}
            >
              {t("decisions.learned_hint")}
            </span>
          )}
          <button
            onClick={() => recordDecision("shortlist")}
            disabled={decisionState === "pending"}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-background hover:bg-accent/90 disabled:opacity-50"
          >
            {t("decisions.approve")}
          </button>
          <button
            onClick={() => recordDecision("rejected")}
            disabled={decisionState === "pending"}
            className="rounded bg-red px-3 py-1.5 text-sm font-medium text-foreground hover:bg-red/90 disabled:opacity-50"
          >
            {t("decisions.reject")}
          </button>
          {onAccept && (
            <button
              onClick={() => onAccept(submission.id)}
              className="rounded border px-3 py-1.5 text-sm font-medium hover:bg-white/5"
              style={{ borderColor: "var(--border)" }}
            >
              {submission.status === "accepted" ? "✓" : "Accept"}
            </button>
          )}
          {onReject && (
            <button
              onClick={() => onReject(submission.id)}
              className="rounded border px-3 py-1.5 text-sm font-medium hover:bg-white/5"
              style={{ borderColor: "var(--border)" }}
            >
              {submission.status === "rejected" ? "✓" : "Reject"}
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
