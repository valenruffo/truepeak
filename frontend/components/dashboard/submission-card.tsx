"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Submission } from "@/lib/api";

interface SubmissionCardProps {
  submission: Submission;
  onAccept?: (id: number) => void;
  onReject?: (id: number) => void;
}

export function SubmissionCard({
  submission,
  onAccept,
  onReject,
}: SubmissionCardProps) {
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
              <span className="text-muted">True Peak</span>
              <p className="text-foreground">
                {submission.true_peak.toFixed(1)} dB
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
        <div className="mt-4 flex gap-2">
          {onAccept && (
            <button
              onClick={() => onAccept(submission.id)}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-background hover:bg-accent/90"
            >
              Accept
            </button>
          )}
          {onReject && (
            <button
              onClick={() => onReject(submission.id)}
              className="rounded bg-red px-3 py-1.5 text-sm font-medium text-foreground hover:bg-red/90"
            >
              Reject
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
