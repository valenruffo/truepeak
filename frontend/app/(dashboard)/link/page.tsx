"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { getSubmissions, type Submission } from "@/lib/api";
import { Copy, Check, ExternalLink, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

const MOCK_SUBMISSIONS: Submission[] = [
  { id: 1, label_id: 1, producer_name: "Alex Rivera", producer_email: "alex@email.com", track_title: "Midnight Protocol", message: null, status: "pending", bpm: 128.4, lufs: -13.2, true_peak: -1.2, phase_correlation: 0.85, duration: 245, mp3_path: null, created_at: "2026-05-04T10:30:00Z" },
  { id: 2, label_id: 1, producer_name: "Sarah Chen", producer_email: "sarah@email.com", track_title: "Neon Dreams", message: null, status: "accepted", bpm: 125.0, lufs: -14.1, true_peak: -0.8, phase_correlation: 0.92, duration: 312, mp3_path: "/data/mp3s/uuid-2.mp3", created_at: "2026-05-03T15:20:00Z" },
  { id: 3, label_id: 1, producer_name: "DJ Kroma", producer_email: "kroma@email.com", track_title: "Bass Drop Vol.3", message: null, status: "rejected", bpm: 140.2, lufs: -6.5, true_peak: 0.3, phase_correlation: -0.15, duration: 198, mp3_path: null, created_at: "2026-05-02T08:45:00Z" },
  { id: 4, label_id: 1, producer_name: "Luna Wave", producer_email: "luna@email.com", track_title: "Ethereal Pulse", message: null, status: "pending", bpm: 122.8, lufs: -15.0, true_peak: -2.1, phase_correlation: 0.78, duration: 278, mp3_path: null, created_at: "2026-05-04T12:00:00Z" },
  { id: 5, label_id: 1, producer_name: "Max Frequency", producer_email: "max@email.com", track_title: "Subterranean", message: null, status: "accepted", bpm: 130.0, lufs: -13.8, true_peak: -1.5, phase_correlation: 0.88, duration: 356, mp3_path: "/data/mp3s/uuid-5.mp3", created_at: "2026-05-01T20:10:00Z" },
  { id: 6, label_id: 1, producer_name: "Nova Beat", producer_email: "nova@email.com", track_title: "Crystal Method", message: null, status: "pending", bpm: 127.0, lufs: -14.5, true_peak: -1.0, phase_correlation: 0.80, duration: 290, mp3_path: null, created_at: "2026-05-04T14:00:00Z" },
];

const LABEL_SLUG = "demo-label";
const SUBMISSION_URL = `https://truepeak.ai/s/${LABEL_SLUG}`;

export default function LinkPage() {
  const { addToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });

  useEffect(() => {
    async function loadStats() {
      try {
        const data = await getSubmissions("1");
        const total = data.length;
        const pending = data.filter((s) => s.status === "pending").length;
        const approved = data.filter((s) => s.status === "accepted").length;
        const rejected = data.filter((s) => s.status === "rejected").length;
        setStats({ total, pending, approved, rejected });
      } catch {
        const data = MOCK_SUBMISSIONS;
        setStats({
          total: data.length,
          pending: data.filter((s) => s.status === "pending").length,
          approved: data.filter((s) => s.status === "accepted").length,
          rejected: data.filter((s) => s.status === "rejected").length,
        });
      }
    }
    loadStats();
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(SUBMISSION_URL);
      setCopied(true);
      addToast({ title: "Copied!", description: "Submission link copied to clipboard.", variant: "success" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast({ title: "Copy failed", description: "Could not copy to clipboard.", variant: "destructive" });
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-8">
        <h2 className="font-display text-3xl font-bold tracking-tight">Submission Link</h2>
        <p className="mt-1 text-muted">Share this URL with producers to receive demo submissions.</p>
      </div>

      {/* URL Card */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-lg">Your Submission URL</CardTitle>
          <CardDescription>Producers can upload WAV files directly through this link.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <div className="flex-1 rounded-lg border border-border bg-surface2 px-4 py-3 font-mono text-sm text-foreground">
              {SUBMISSION_URL}
            </div>
            <Button onClick={handleCopy} className={cn("shrink-0 gap-1.5", copied && "bg-accent/80")}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="outline" size="icon" onClick={() => window.open(`/s/${LABEL_SLUG}`, "_blank")}>
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-4 gap-4">
        {[
          { label: "Total", value: stats.total, icon: BarChart3, color: "text-foreground" },
          { label: "Pending", value: stats.pending, icon: BarChart3, color: "text-cyan" },
          { label: "Approved", value: stats.approved, icon: BarChart3, color: "text-accent" },
          { label: "Rejected", value: stats.rejected, icon: BarChart3, color: "text-red" },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <stat.icon className={cn("h-5 w-5", stat.color)} />
              <div>
                <p className={cn("text-2xl font-bold font-display", stat.color)}>{stat.value}</p>
                <p className="text-xs text-muted">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Producer Preview</CardTitle>
          <CardDescription>This is what producers see when they visit your submission link.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-border bg-surface2 p-6">
            <div className="text-center">
              <h3 className="font-display text-xl font-bold text-foreground">Demo Label</h3>
              <p className="mt-1 text-sm text-muted">Submit your demo for review</p>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3 text-xs font-mono">
              <div className="rounded border border-border bg-surface p-2 text-center">
                <span className="text-muted">BPM Range</span>
                <p className="text-foreground">120 — 130</p>
              </div>
              <div className="rounded border border-border bg-surface p-2 text-center">
                <span className="text-muted">LUFS Target</span>
                <p className="text-foreground">-14 ± 2</p>
              </div>
              <div className="rounded border border-border bg-surface p-2 text-center">
                <span className="text-muted">Max Size</span>
                <p className="text-foreground">100 MB</p>
              </div>
            </div>
            <div className="mt-4 rounded-lg border-2 border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted">Drag & drop your WAV file here</p>
              <p className="mt-1 text-xs text-muted/60">or click to browse</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
