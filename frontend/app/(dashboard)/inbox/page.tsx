"use client";

import { useState, useEffect, useCallback } from "react";
import { appStore } from "@/lib/store";
import { getSubmissions, updateSubmissionStatus, type Submission } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { AudioPlayer } from "@/components/dashboard/audio-player";
import { useToast } from "@/components/ui/toast";
import { Loader2, Headphones, Check, X, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type FilterTab = "all" | "pending" | "approved" | "rejected";

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

// Mock data for when API is not available
const MOCK_SUBMISSIONS: Submission[] = [
  {
    id: 1, label_id: 1, producer_name: "Alex Rivera", producer_email: "alex@email.com",
    track_title: "Midnight Protocol", message: null, status: "pending",
    bpm: 128.4, lufs: -13.2, true_peak: -1.2, phase_correlation: 0.85,
    duration: 245, mp3_path: null, created_at: "2026-05-04T10:30:00Z",
  },
  {
    id: 2, label_id: 1, producer_name: "Sarah Chen", producer_email: "sarah@email.com",
    track_title: "Neon Dreams", message: null, status: "accepted",
    bpm: 125.0, lufs: -14.1, true_peak: -0.8, phase_correlation: 0.92,
    duration: 312, mp3_path: "/data/mp3s/uuid-2.mp3", created_at: "2026-05-03T15:20:00Z",
  },
  {
    id: 3, label_id: 1, producer_name: "DJ Kroma", producer_email: "kroma@email.com",
    track_title: "Bass Drop Vol.3", message: null, status: "rejected",
    bpm: 140.2, lufs: -6.5, true_peak: 0.3, phase_correlation: -0.15,
    duration: 198, mp3_path: null, created_at: "2026-05-02T08:45:00Z",
  },
  {
    id: 4, label_id: 1, producer_name: "Luna Wave", producer_email: "luna@email.com",
    track_title: "Ethereal Pulse", message: null, status: "pending",
    bpm: 122.8, lufs: -15.0, true_peak: -2.1, phase_correlation: 0.78,
    duration: 278, mp3_path: null, created_at: "2026-05-04T12:00:00Z",
  },
  {
    id: 5, label_id: 1, producer_name: "Max Frequency", producer_email: "max@email.com",
    track_title: "Subterranean", message: null, status: "accepted",
    bpm: 130.0, lufs: -13.8, true_peak: -1.5, phase_correlation: 0.88,
    duration: 356, mp3_path: "/data/mp3s/uuid-5.mp3", created_at: "2026-05-01T20:10:00Z",
  },
];

function StatusBadge({ status }: { status: Submission["status"] }) {
  const config = {
    pending: { bg: "bg-cyan/10", text: "text-cyan", label: "Pending" },
    accepted: { bg: "bg-accent/10", text: "text-accent", label: "Approved" },
    rejected: { bg: "bg-red/10", text: "text-red", label: "Rejected" },
  };
  const c = config[status];
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", c.bg, c.text)}>
      {c.label}
    </span>
  );
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function InboxPage() {
  const { addToast } = useToast();
  const submissions = appStore((s) => s.submissions);
  const filters = appStore((s) => s.filters);
  const setFilter = appStore((s) => s.setFilter);
  const setSubmissions = appStore((s) => s.setSubmissions);
  const updateStatus = appStore((s) => s.updateSubmissionStatus);

  const [loading, setLoading] = useState(true);
  const [listenDialog, setListenDialog] = useState<Submission | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const loadSubmissions = useCallback(async () => {
    try {
      const data = await getSubmissions("1");
      setSubmissions(data);
    } catch {
      // Fallback to mock data
      setSubmissions(MOCK_SUBMISSIONS);
    } finally {
      setLoading(false);
    }
  }, [setSubmissions]);

  useEffect(() => {
    loadSubmissions();
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadSubmissions, 30000);
    return () => clearInterval(interval);
  }, [loadSubmissions]);

  async function handleAction(id: number, action: "accepted" | "rejected") {
    setActionLoading(id);
    try {
      await updateSubmissionStatus(id, action);
      updateStatus(id, action);
      addToast({
        title: action === "accepted" ? "Track approved" : "Track rejected",
        description: `Submission has been ${action === "accepted" ? "approved" : "rejected"}.`,
        variant: action === "accepted" ? "success" : "destructive",
      });
    } catch {
      // Optimistic update for demo
      updateStatus(id, action);
      addToast({
        title: action === "accepted" ? "Track approved" : "Track rejected",
        description: "Status updated (demo mode).",
        variant: action === "accepted" ? "success" : "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  }

  const filtered = submissions.filter((s) => {
    if (filters.status === "all") return true;
    if (filters.status === "pending") return s.status === "pending";
    return s.status === filters.status;
  });

  return (
    <div className="px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight">Demo Inbox</h2>
          <p className="mt-1 text-muted">Review and filter incoming submissions.</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadSubmissions} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Filter Tabs */}
      <div className="mb-4 flex gap-1 rounded-lg bg-surface p-1 w-fit">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-all",
              filters.status === tab.key
                ? "bg-surface2 text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.key !== "all" && (
              <span className="ml-1.5 text-xs opacity-60">
                ({submissions.filter((s) => tab.key === "all" || s.status === tab.key).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-surface">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="font-display text-lg font-semibold text-foreground">No submissions</p>
            <p className="mt-1 text-sm text-muted">
              {filters.status !== "all"
                ? `No ${filters.status} submissions found.`
                : "Share your submission link to start receiving demos."}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Track</TableHead>
                <TableHead>Producer</TableHead>
                <TableHead className="font-mono">BPM</TableHead>
                <TableHead className="font-mono">LUFS</TableHead>
                <TableHead className="font-mono">Phase</TableHead>
                <TableHead className="font-mono">Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell className="font-medium">{sub.track_title}</TableCell>
                  <TableCell className="text-muted">{sub.producer_name}</TableCell>
                  <TableCell className="font-mono text-sm">{sub.bpm?.toFixed(1) ?? "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{sub.lufs?.toFixed(1) ?? "—"}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {sub.phase_correlation != null
                      ? (sub.phase_correlation > 0 ? "+" : "") + sub.phase_correlation.toFixed(2)
                      : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-sm">—</TableCell>
                  <TableCell><StatusBadge status={sub.status} /></TableCell>
                  <TableCell className="text-xs text-muted">{formatDate(sub.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => setListenDialog(sub)}
                        title="Listen"
                      >
                        <Headphones className="h-3.5 w-3.5" />
                      </Button>
                      {sub.status === "pending" && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-accent hover:text-accent"
                            onClick={() => handleAction(sub.id, "accepted")}
                            disabled={actionLoading === sub.id}
                            title="Approve"
                          >
                            {actionLoading === sub.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-red hover:text-red"
                            onClick={() => handleAction(sub.id, "rejected")}
                            disabled={actionLoading === sub.id}
                            title="Reject"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Listen Dialog */}
      <Dialog open={!!listenDialog} onOpenChange={() => setListenDialog(null)}>
        {listenDialog && (
          <>
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>{listenDialog.track_title}</DialogTitle>
              <p className="text-sm text-muted">by {listenDialog.producer_name}</p>
            </DialogHeader>
            <DialogContent>
              <AudioPlayer
                src={listenDialog.mp3_path || undefined}
                trackTitle={listenDialog.track_title}
              />
              <div className="mt-3 grid grid-cols-4 gap-3 text-xs font-mono">
                <div><span className="text-muted">BPM</span><p className="text-foreground">{listenDialog.bpm?.toFixed(1)}</p></div>
                <div><span className="text-muted">LUFS</span><p className="text-foreground">{listenDialog.lufs?.toFixed(1)}</p></div>
                <div><span className="text-muted">Phase</span><p className="text-foreground">{listenDialog.phase_correlation?.toFixed(2)}</p></div>
                <div><span className="text-muted">Duration</span><p className="text-foreground">{formatDuration(listenDialog.duration)}</p></div>
              </div>
            </DialogContent>
            <DialogFooter className="px-6 pb-6">
              {listenDialog.status === "pending" && (
                <div className="flex gap-2">
                  <Button variant="destructive" size="sm" onClick={() => { handleAction(listenDialog.id, "rejected"); setListenDialog(null); }}>
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => { handleAction(listenDialog.id, "accepted"); setListenDialog(null); }}>
                    Approve
                  </Button>
                </div>
              )}
            </DialogFooter>
          </>
        )}
      </Dialog>
    </div>
  );
}
