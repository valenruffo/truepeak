"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { usePlayer } from "@/lib/PlayerContext";
import TwoClickDelete from "@/components/TwoClickDelete";
import { useLanguage } from "@/lib/i18n";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import { Clock, Mail, AlertTriangle, Trash2, RotateCcw, X } from "lucide-react";
import { useToast } from "@/components/ui/toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = "kanban" | "system" | "trash";

interface SubmissionSummary {
  id: string;
  producer_name: string;
  producer_email: string | null;
  track_name: string;
  status: string;
  bpm: number | null;
  lufs: number | null;
  duration: number | null;
  phase_correlation: number | null;
  musical_key: string | null;
  true_peak: number | null;
  crest_factor: number | null;
  mp3_path: string | null;
  original_path: string | null;
  human_email_sent?: boolean;
  rejection_reason?: string | null;
  notes?: string | null;
  created_at: string;
  deleted_at?: string | null;
}

interface EmailTemplate {
  id: string;
  name: string;
  template_type: string;
  subject_template: string;
  body_template: string;
}

interface BoardState {
  inbox: SubmissionSummary[];
  shortlist: SubmissionSummary[];
  rejected: SubmissionSummary[];
}

interface EmailModalState {
  open: boolean;
  submission: SubmissionSummary | null;
  targetStatus: "shortlist" | "rejected" | null;
  templates: EmailTemplate[];
  selectedTemplate: string;
  subject: string;
  body: string;
  sending: boolean;
  sent: boolean;
  error: string | null;
}

interface DetailModalState {
  open: boolean;
  submission: SubmissionSummary | null;
}

interface ConfirmModalState {
  open: boolean;
  submission: SubmissionSummary | null;
  loading: boolean;
}

const PAGE_SIZE = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(isoDate: string): string {
  const now = new Date();
  const date = new Date(isoDate);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "Ahora";
  if (diffMin < 60) return `Hace ${diffMin} min`;
  if (diffHr < 24) return `Hace ${diffHr}h`;
  if (diffDay === 1) return "Ayer";
  if (diffDay < 7) return `Hace ${diffDay}d`;
  return date.toLocaleDateString("es-AR");
}

function formatBpm(bpm: number | null): string {
  return bpm != null ? String(Math.round(bpm)) : "—";
}

function formatLufs(lufs: number | null): string {
  return lufs != null ? lufs.toFixed(1) : "—";
}

function formatKey(key: string | null): string {
  return key ?? "—";
}

function formatPeak(peak: number | null): string {
  return peak != null ? peak.toFixed(2) : "—";
}

function formatCrest(crest: number | null): string {
  return crest != null ? crest.toFixed(1) : "—";
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function replaceVariables(
  template: string,
  sub: SubmissionSummary
): string {
  return template
    .replace(/\{producer_name\}/g, sub.producer_name || "Productor")
    .replace(/\{track_name\}/g, sub.track_name || "Track")
    .replace(/\{producer\}/g, sub.producer_name || "Productor")
    .replace(/\{track\}/g, sub.track_name || "Track")
    .replace(/\{bpm\}/g, sub.bpm ? String(Math.round(sub.bpm)) : "—");
}

function statusBadgeColor(status: string): { bg: string; color: string } {
  switch (status) {
    case "inbox":
    case "pending":
      return { bg: "rgba(6,182,212,0.15)", color: "#06b6d4" };
    case "shortlist":
    case "approved":
      return { bg: "rgba(16,185,129,0.15)", color: "#10b981" };
    case "rejected":
    case "auto_rejected":
      return { bg: "rgba(239,68,68,0.15)", color: "#ef4444" };
    default:
      return { bg: "rgba(161,161,170,0.15)", color: "#a1a1aa" };
  }
}

function statusLabel(status: string, t: (key: "inbox.status.pending" | "inbox.status.approved" | "inbox.status.rejected") => string): string {
  switch (status) {
    case "inbox":
    case "pending":
      return t("inbox.status.pending");
    case "shortlist":
    case "approved":
      return t("inbox.status.approved");
    case "rejected":
    case "auto_rejected":
      return t("inbox.status.rejected");
    default:
      return status;
  }
}

function ExpirationCountdown({ createdAt, retentionDays }: { createdAt: string, retentionDays: number }) {
  if (retentionDays === 0) return null; // Free plan tracks don't expire
  const created = new Date(createdAt).getTime();
  const expiresAt = created + retentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const timeLeft = expiresAt - now;

  if (timeLeft <= 0) {
    return <span className="text-red-500 font-medium">Expirado (Papelera)</span>;
  }

  const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
  const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  const isWarning = days < 1;
  return (
    <span className={cn("flex items-center gap-1", isWarning ? "text-amber-500 font-medium" : "text-muted")}>
      <Clock className="w-3.5 h-3.5" /> Expira en {days}d {hours}h
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="max-w-7xl mx-auto px-6 py-8"><div className="animate-pulse h-96 rounded" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }} /></div>}>
      <InboxContent />
    </Suspense>
  );
}

function InboxContent() {
  const { t } = useLanguage();
  const { playTrack, togglePlay, isPlaying, currentTrack } = usePlayer();
  const { addToast } = useToast();
  const searchParams = useSearchParams();
  const highlightParam = searchParams.get("highlight");

  const [activeTab, setActiveTab] = useState<TabKey>("kanban");
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Role for dynamic i18n keys
  const [role, setRole] = useState<"label" | "dj">("label");

  // Kanban board state
  const [board, setBoard] = useState<BoardState>({
    inbox: [],
    shortlist: [],
    rejected: [],
  });
  const [boardOffsets, setBoardOffsets] = useState({ inbox: 0, shortlist: 0, rejected: 0 });
  const [boardHasMore, setBoardHasMore] = useState({ inbox: true, shortlist: true, rejected: true });
  const [boardLoading, setBoardLoading] = useState<Record<string, boolean>>({});

  // System filtered (auto_rejected)
  const [systemItems, setSystemItems] = useState<SubmissionSummary[]>([]);
  const [systemOffset, setSystemOffset] = useState(0);
  const [systemHasMore, setSystemHasMore] = useState(true);
  const [systemLoading, setSystemLoading] = useState(false);

  // Trash (soft deleted)
  const [trashItems, setTrashItems] = useState<SubmissionSummary[]>([]);
  const [trashOffset, setTrashOffset] = useState(0);
  const [trashHasMore, setTrashHasMore] = useState(true);
  const [trashLoading, setTrashLoading] = useState(false);

  // Email modal
  const [emailModal, setEmailModal] = useState<EmailModalState>({
    open: false,
    submission: null,
    targetStatus: null,
    templates: [],
    selectedTemplate: "",
    subject: "",
    body: "",
    sending: false,
    sent: false,
    error: null,
  });

  // Detail modal
  const [detailModal, setDetailModal] = useState<DetailModalState>({
    open: false,
    submission: null,
  });

  // Confirmation modal
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    open: false,
    submission: null,
    loading: false,
  });

  // Badge & interaction state
  const [interactedIds, setInteractedIds] = useState<Set<string>>(new Set());
  const [hasSeenSystem, setHasSeenSystem] = useState(false);

  const markAsInteracted = useCallback((id: string) => {
    setInteractedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

useEffect(() => {
    if (typeof window !== "undefined") {
      const override = localStorage.getItem("admin_plan_override");
      const plan = override || localStorage.getItem("plan") || "free";
      setRetentionDays(plan === "pro" ? 14 : plan === "indie" ? 7 : 0);
      const storedRole = localStorage.getItem("role");
      if (storedRole === "dj" || storedRole === "label") {
        setRole(storedRole);
      }
    }
  }, []);

  useEffect(() => {
    if (activeTab === "system") setHasSeenSystem(true);
  }, [activeTab]);

  // HQ Retention Days for countdowns
  const [retentionDays, setRetentionDays] = useState<number>(0);
  const [sonicSignature, setSonicSignature] = useState<any>(null);

  useEffect(() => {
    const fetchSignature = async () => {
      const slug = localStorage.getItem("slug");
      if (!slug) return;
      try {
        const res = await fetch(`/api/labels/${slug}`);
        if (res.ok) {
          const data = await res.json();
          setSonicSignature(data.sonic_signature);
        }
      } catch (e) { /* silent */ }
    };
    fetchSignature();
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const override = localStorage.getItem("admin_plan_override");
      const plan = override || localStorage.getItem("plan") || "free";
      setRetentionDays(plan === "pro" ? 14 : plan === "indie" ? 7 : 0);
    }
  }, []);

  // Action loading per card
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});

  // Rejection reason for drag-to-reject
  const [pendingReject, setPendingReject] = useState<{
    sub: SubmissionSummary;
    reason: string;
  } | null>(null);

  // Scroll refs for infinite scroll
  const inboxScrollRef = useRef<HTMLDivElement>(null);
  const shortlistScrollRef = useRef<HTMLDivElement>(null);
  const rejectedScrollRef = useRef<HTMLDivElement>(null);
  const systemScrollRef = useRef<HTMLDivElement>(null);
  const trashScrollRef = useRef<HTMLDivElement>(null);

  const API = "";

  // ─── Auth headers helper ─────────────────────────────────────────────────

  const getAuthHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  };

  // ─── Fetch helpers ────────────────────────────────────────────────────────

  const fetchColumn = useCallback(
    async (column: "inbox" | "shortlist" | "rejected", append = false) => {
      const statusMap: Record<"inbox" | "shortlist" | "rejected", string> = {
        inbox: "inbox",
        shortlist: "shortlist",
        rejected: "rejected",
      };
      const offset = append ? boardOffsets[column] : 0;
      const key = column;

      setBoardLoading((p) => ({ ...p, [key]: true }));
      try {
        const res = await fetch(
          `/api/submissions?status=${statusMap[column]}&offset=${offset}&limit=${PAGE_SIZE}`,
          { credentials: "include", headers: getAuthHeaders() }
        );
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(`[${column}] HTTP ${res.status}: ${errBody?.detail || res.statusText}`);
        }
        const data: SubmissionSummary[] = await res.json();
        setFetchError(null);
        setBoard((prev) => ({
          ...prev,
          [column]: append ? [...prev[column], ...data] : data,
        }));
        setBoardOffsets((prev) => ({
          ...prev,
          [column]: append ? prev[column] + data.length : data.length,
        }));
        setBoardHasMore((prev) => ({
          ...prev,
          [column]: data.length === PAGE_SIZE,
        }));
      } catch (e) {
        setFetchError(e instanceof Error ? e.message : "Error desconocido cargando submissions");
      } finally {
        setBoardLoading((p) => ({ ...p, [key]: false }));
      }
    },
    [boardOffsets]
  );

  const fetchSystem = useCallback(
    async (append = false) => {
      const offset = append ? systemOffset : 0;
      setSystemLoading(true);
      try {
        const res = await fetch(
          `/api/submissions?status=auto_rejected&offset=${offset}&limit=${PAGE_SIZE}`,
          { credentials: "include", headers: getAuthHeaders() }
        );
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(`[system] HTTP ${res.status}: ${errBody?.detail || res.statusText}`);
        }
        const data: SubmissionSummary[] = await res.json();
        setFetchError(null);
        setSystemItems((prev) => (append ? [...prev, ...data] : data));
        setSystemOffset(append ? offset + data.length : data.length);
        setSystemHasMore(data.length === PAGE_SIZE);
      } catch (e) {
        setFetchError(e instanceof Error ? e.message : t("inbox.error_load_system"));
      } finally {
        setSystemLoading(false);
      }
    },
    [systemOffset]
  );

  const fetchTrash = useCallback(
    async (append = false) => {
      const offset = append ? trashOffset : 0;
      setTrashLoading(true);
      try {
        const res = await fetch(
          `/api/submissions?include_deleted=true&offset=${offset}&limit=${PAGE_SIZE}`,
          { credentials: "include", headers: getAuthHeaders() }
        );
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(`[trash] HTTP ${res.status}: ${errBody?.detail || res.statusText}`);
        }
        const data: SubmissionSummary[] = await res.json();
        // Keep only soft-deleted items
        const deleted = data.filter((d) => d.deleted_at);
        setTrashItems((prev) => (append ? [...prev, ...deleted] : deleted));
        setTrashOffset(append ? offset + deleted.length : deleted.length);
        setTrashHasMore(deleted.length === PAGE_SIZE);
      } catch (e) {
        setFetchError(e instanceof Error ? e.message : t("inbox.error_load_trash"));
      } finally {
        setTrashLoading(false);
      }
    },
    [trashOffset]
  );

  // ─── Initial load ─────────────────────────────────────────────────────────

  useEffect(() => {
    fetchColumn("inbox");
    fetchColumn("shortlist");
    fetchColumn("rejected");
    fetchSystem();
    fetchTrash();
  }, []);

  // ─── Infinite scroll handlers ─────────────────────────────────────────────

  const handleScroll = useCallback(
    (
      e: React.UIEvent<HTMLDivElement>,
      column: "inbox" | "shortlist" | "rejected" | "system" | "trash"
    ) => {
      const el = e.currentTarget;
      const nearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 200;
      if (!nearBottom) return;

      if (column === "inbox" && boardHasMore.inbox && !boardLoading.inbox) {
        fetchColumn("inbox", true);
      } else if (
        column === "shortlist" &&
        boardHasMore.shortlist &&
        !boardLoading.shortlist
      ) {
        fetchColumn("shortlist", true);
      } else if (
        column === "rejected" &&
        boardHasMore.rejected &&
        !boardLoading.rejected
      ) {
        fetchColumn("rejected", true);
      } else if (column === "system" && systemHasMore && !systemLoading) {
        fetchSystem(true);
      } else if (column === "trash" && trashHasMore && !trashLoading) {
        fetchTrash(true);
      }
    },
    [
      boardHasMore,
      boardLoading,
      systemHasMore,
      systemLoading,
      trashHasMore,
      trashLoading,
      fetchColumn,
      fetchSystem,
      fetchTrash,
    ]
  );

  // ─── Drag & Drop ──────────────────────────────────────────────────────────

  const handleDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    )
      return;

    const subId = draggableId;

    // Find the submission
    let sub: SubmissionSummary | null = null;
    let sourceCol: string = source.droppableId;
    for (const col of ["inbox", "shortlist", "rejected"]) {
      const found = board[col as keyof BoardState].find(
        (s) => s.id === subId
      );
      if (found) {
        sub = found;
        break;
      }
    }
    if (!sub) return;

    const targetStatus =
      destination.droppableId === "shortlist"
        ? "shortlist"
        : destination.droppableId === "rejected"
        ? "rejected"
        : null;

    // If dropping to same column or inbox, no status change needed
    if (!targetStatus || destination.droppableId === sourceCol) return;

    // If rejecting, we need a reason — open rejection modal
    if (targetStatus === "rejected") {
      setPendingReject({ sub, reason: "" });
      return;
    }

    // Shortlist: update status then open email modal
    markAsInteracted(subId);
    await updateStatus(sub, "shortlist");
  };

  const updateStatus = async (
    sub: SubmissionSummary,
    status: "shortlist" | "rejected",
    reason?: string
  ) => {
    setActionLoading((p) => ({ ...p, [sub.id]: status }));
    try {
      const body: Record<string, unknown> = { status };
      if (status === "rejected" && reason) {
        body.rejection_reason = reason;
      }
      const res = await fetch(`/api/submissions/${sub.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Error ${res.status}`);
      }

      // Remove from source column, add to target
      setBoard((prev) => {
        const next = { ...prev };
        for (const col of ["inbox", "shortlist", "rejected"] as const) {
          next[col] = next[col].filter((s) => s.id !== sub.id);
        }
        const updated = { ...sub, status };
        if (status === "shortlist") {
          next.shortlist = [updated, ...next.shortlist];
        } else if (status === "rejected") {
          next.rejected = [updated, ...next.rejected];
        }
        return next;
      });

      // Open email modal for shortlist or rejected
      if (status === "shortlist" || status === "rejected") {
        openEmailModal(sub, status);
      }
    } catch (e) {
      addToast({
        title: "Error",
        description: e instanceof Error ? e.message : t("inbox.error_unknown"),
        variant: "destructive",
      });
    } finally {
      setActionLoading((p) => {
        const next = { ...p };
        delete next[sub.id];
        return next;
      });
    }
  };

  // ─── Email Modal ──────────────────────────────────────────────────────────

  const openEmailModal = async (
    sub: SubmissionSummary,
    targetStatus: "shortlist" | "rejected"
  ) => {
    // Fetch templates
    let templates: EmailTemplate[] = [];
    try {
      const res = await fetch("/api/email/templates", {
        credentials: "include",
      });
      if (res.ok) templates = await res.json();
    } catch {
      // silent
    }

    // Pick first matching template
    const targetType =
      targetStatus === "shortlist" ? "approval" : "rejection";
    const firstMatch = templates.find(
      (t) => t.template_type === targetType
    );

    setEmailModal({
      open: true,
      submission: sub,
      targetStatus,
      templates,
      selectedTemplate: firstMatch?.id || "",
      subject: firstMatch
        ? replaceVariables(firstMatch.subject_template, sub)
        : "",
      body: firstMatch
        ? replaceVariables(firstMatch.body_template, sub)
        : "",
      sending: false,
      sent: false,
      error: null,
    });
  };

  const handleTemplateChange = (templateId: string) => {
    const tmpl = emailModal.templates.find((t) => t.id === templateId);
    if (!tmpl || !emailModal.submission) return;
    setEmailModal((prev) => ({
      ...prev,
      selectedTemplate: templateId,
      subject: replaceVariables(tmpl.subject_template, prev.submission!),
      body: replaceVariables(tmpl.body_template, prev.submission!),
    }));
  };

  const handleSendEmail = async () => {
    if (!emailModal.submission) return;
    setEmailModal((p) => ({ ...p, sending: true, error: null }));
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          to: emailModal.submission.producer_email || "",
          subject: emailModal.subject,
          body: emailModal.body,
          from_name: "True Peak AI",
          submission_id: emailModal.submission.id,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Error ${res.status}`);
      }
      setEmailModal((p) => ({ ...p, sending: false, sent: true }));
      setTimeout(() => {
        setEmailModal((p) => ({ ...p, open: false }));
      }, 1500);
    } catch (e) {
      setEmailModal((p) => ({
        ...p,
        sending: false,
        error: e instanceof Error ? e.message : t("inbox.kanban.email_error"),
      }));
    }
  };

  const closeEmailModal = () => {
    setEmailModal((p) => ({ ...p, open: false }));
  };

  // ─── Delete / Restore ─────────────────────────────────────────────────────

  const handleDelete = async (sub: SubmissionSummary) => {
    setActionLoading((p) => ({ ...p, [sub.id]: "delete" }));
    const isHardDelete = !!sub.deleted_at;
    try {
      const res = await fetch(`/api/submissions/${sub.id}${isHardDelete ? "?force=true" : ""}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      
      if (isHardDelete) {
        // Remove permanently from trash
        setTrashItems((prev) => prev.filter((s) => s.id !== sub.id));
      } else {
        // Soft delete: remove from board/system and move to trash locally
        setBoard((prev) => {
          const next = { ...prev };
          for (const col of ["inbox", "shortlist", "rejected"] as const) {
            next[col] = next[col].filter((s) => s.id !== sub.id);
          }
          return next;
        });
        setSystemItems((prev) => prev.filter((s) => s.id !== sub.id));
        setTrashItems((prev) => [{ ...sub, deleted_at: new Date().toISOString() }, ...prev]);
        addToast({ title: t("inbox.kanban.sent_to_trash"), variant: "default" });
      }
    } catch (e) {
      addToast({
        title: "Error",
        description: e instanceof Error ? e.message : t("inbox.error_unknown"),
        variant: "destructive",
      });
    } finally {
      setActionLoading((p) => {
        const next = { ...p };
        delete next[sub.id];
        return next;
      });
    }
  };

  const handleRestore = async (sub: SubmissionSummary) => {
    setActionLoading((p) => ({ ...p, [sub.id]: "restore" }));
    try {
      const res = await fetch(
        `/api/submissions/${sub.id}/restore`,
        {
          method: "PATCH",
          credentials: "include",
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          err.detail || t("inbox.kanban.restore_expired")
        );
      }
      // Remove from trash
      setTrashItems((prev) => prev.filter((s) => s.id !== sub.id));
      
      // Move back to its original status column
      const targetCol = (["inbox", "shortlist", "rejected"].includes(sub.status) ? sub.status : "inbox") as "inbox" | "shortlist" | "rejected";
      setBoard((prev) => ({
        ...prev,
        [targetCol]: [{ ...sub, deleted_at: null }, ...prev[targetCol]].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
      }));
      addToast({ title: "Demo restaurado correctamente", variant: "success" });
    } catch (e) {
      addToast({
        title: "Error al restaurar",
        description: e instanceof Error ? e.message : t("inbox.error_unknown"),
        variant: "destructive",
      });
    } finally {
      setActionLoading((p) => {
        const next = { ...p };
        delete next[sub.id];
        return next;
      });
    }
  };

  const handlePermanentDelete = async (sub: SubmissionSummary) => {
    setConfirmModal({ open: true, submission: sub, loading: false });
  };

  const confirmPermanentDelete = async () => {
    const sub = confirmModal.submission;
    if (!sub) return;

    setConfirmModal(p => ({ ...p, loading: true }));
    try {
      const res = await fetch(`/api/submissions/${sub.id}?force=true`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Error al eliminar");
      }
      
      setTrashItems((prev) => prev.filter((item) => item.id !== sub.id));
      addToast({ title: "Eliminado permanentemente", variant: "success" });
      setConfirmModal({ open: false, submission: null, loading: false });
    } catch (e) {
      addToast({
        title: "Error al eliminar",
        description: e instanceof Error ? e.message : "Error al eliminar permanentemente",
        variant: "destructive",
      });
      setConfirmModal(p => ({ ...p, loading: false }));
    }
  };

  // ─── Listen ───────────────────────────────────────────────────────────────

  const handleListen = (sub: SubmissionSummary) => {
    if (!sub.mp3_path) return;
    markAsInteracted(sub.id);
    if (currentTrack?.id === sub.id) {
      togglePlay();
    } else {
      playTrack({
        id: sub.id,
        track_name: sub.track_name || t("inbox.modal.no_name"),
        producer_name: sub.producer_name || t("inbox.modal.anonymous"),
        mp3_path: sub.mp3_path,
      });
    }
  };

  // ─── Handle pending reject submit ─────────────────────────────────────────

  const handleRejectSubmit = () => {
    if (!pendingReject) return;
    if (!pendingReject.reason.trim()) {
      addToast({
        title: t("inbox.kanban.rejection_reason_required"),
        variant: "destructive",
      });
      return;
    }
    updateStatus(
      pendingReject.sub,
      "rejected",
      pendingReject.reason.trim()
    );
    setPendingReject(null);
  };

  // ─── Render: Kanban Card ──────────────────────────────────────────────────

  const renderCard = (sub: SubmissionSummary, index: number, colId: string) => {
    const badge = statusBadgeColor(sub.status);
    const isLoading = actionLoading[sub.id];
    const isPlayingThis = currentTrack?.id === sub.id && isPlaying;

    return (
      <Draggable key={sub.id} draggableId={sub.id} index={index}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            className={cn(
              "rounded border mb-2 transition-shadow overflow-hidden",
              snapshot.isDragging && "shadow-lg opacity-80"
            )}
            style={{
              background: "var(--bg-card)",
              borderColor: "var(--border)",
              ...provided.draggableProps.style,
            }}
          >
            {/* Clickable zone for details */}
            <div 
              className="cursor-pointer hover:bg-white/[0.02] transition-colors"
              onClick={() => {
                markAsInteracted(sub.id);
                setDetailModal({ open: true, submission: sub });
              }}
            >
              {/* Drag handle — thin visual indicator */}
              <div className="h-1" style={{ background: "rgba(255,255,255,0.03)", borderTop: "1px solid rgba(255,255,255,0.04)" }} />

              {/* Top row — full-width drag zone */}
              <div className="flex items-start gap-2 px-3 pt-2.5 cursor-grab active:cursor-grabbing" {...provided.dragHandleProps} onClick={(e) => e.stopPropagation()}>
                {/* Grip icon — subtle visual cue */}
                <div className="mt-0.5 flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="1.5" />
                    <circle cx="15" cy="6" r="1.5" />
                    <circle cx="9" cy="12" r="1.5" />
                    <circle cx="15" cy="12" r="1.5" />
                    <circle cx="9" cy="18" r="1.5" />
                    <circle cx="15" cy="18" r="1.5" />
                  </svg>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate group-hover/card:text-emerald-500 transition-colors">
                    {sub.track_name || t("inbox.modal.no_name")}
                  </div>
                  <div className="text-[11px] text-muted mt-0.5">
                    {sub.producer_name || t("inbox.modal.anonymous")}
                  </div>
                </div>
              </div>

              {/* Metrics row */}
              <div className="flex items-center gap-3 px-3 py-1.5 text-[11px] font-mono flex-wrap">
                <span>{formatBpm(sub.bpm)} BPM</span>
                <span>{formatLufs(sub.lufs)} LUFS</span>
                <span>{formatKey(sub.musical_key)}</span>
              </div>

              {/* Badges row */}
              <div className="flex items-center gap-1.5 px-3 pb-1.5 flex-wrap">
                <span
                  className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: badge.bg, color: badge.color }}
                >
                  {statusLabel(sub.status, t)}
                </span>
                {sub.human_email_sent && (
                  <span
                    className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      background: "rgba(16,185,129,0.10)",
                      color: "#10b981",
                    }}
                  >
                    {t("inbox.kanban.email_sent")}
                  </span>
                )}
                <div className="text-[10px]">
                  <ExpirationCountdown createdAt={sub.created_at} retentionDays={retentionDays} />
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1 px-3 pb-2.5">
              {sub.mp3_path && (
                <button
                  onClick={() => handleListen(sub)}
                  disabled={!!isLoading}
                  className="w-6 h-6 rounded flex items-center justify-center transition-colors hover:bg-white/10 disabled:opacity-50"
                  style={{
                    color: isPlayingThis ? "#10b981" : "var(--text-secondary)",
                  }}
                  title="Reproducir"
                >
                  {isPlayingThis ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  )}
                </button>
              )}
              {sub.producer_email && (
                <Link
                  href={`/crm?highlight=${sub.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    markAsInteracted(sub.id);
                  }}
                  className="w-6 h-6 rounded flex items-center justify-center transition-colors hover:bg-white/10"
                  style={{ color: "#10b981" }}
                  title="Ver en CRM"
                >
                  <Mail className="w-4 h-4" />
                </Link>
              )}
              <div className="flex-1" />
              {colId !== "shortlist" && (
                <button
                  onClick={() => updateStatus(sub, "shortlist")}
                  disabled={!!isLoading}
                  className="px-2 py-0.5 rounded text-[10px] font-medium disabled:opacity-50 transition-colors hover:bg-white/10"
                  style={{ background: "#10b981", color: "#09090b" }}
                >
                  {isLoading === "shortlist"
                    ? "..."
                    : t("inbox.kanban.approve")}
                </button>
              )}
              {colId !== "rejected" && (
                <button
                  onClick={() => {
                    setPendingReject({ sub, reason: "" });
                  }}
                  disabled={!!isLoading}
                  className="px-2 py-0.5 rounded text-[10px] font-medium disabled:opacity-50 transition-colors hover:bg-white/10"
                  style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}
                >
                  {isLoading === "rejected"
                    ? "..."
                    : t("inbox.kanban.reject")}
                </button>
              )}
              <TwoClickDelete
                onDelete={() => handleDelete(sub)}
                size={20}
              />
            </div>
          </div>
        )}
      </Draggable>
    );
  };

  // ─── Render: Kanban Column ────────────────────────────────────────────────

  const renderColumn = (
    colId: "inbox" | "shortlist" | "rejected",
    title: string,
    accentColor: string
  ) => {
    const items = board[colId];
    const loading = boardLoading[colId];
    const hasMore = boardHasMore[colId];

    return (
      <div
        className="flex flex-col rounded border overflow-hidden"
        style={{
          background: "var(--bg-secondary)",
          borderColor: "var(--border)",
          minWidth: 0,
        }}
      >
        {/* Column header */}
        <div
          className="px-3 py-2 border-b flex items-center gap-2"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: accentColor }}
          />
          <span className="text-xs font-semibold uppercase tracking-wider">
            {title}
          </span>
          <span
            className="text-[10px] font-mono ml-auto"
            style={{ color: "var(--text-muted)" }}
          >
            {items.length}
          </span>
        </div>

        {/* Droppable area */}
        <Droppable droppableId={colId}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className="flex-1 overflow-y-auto p-2"
              style={{
                minHeight: "200px",
                maxHeight: "calc(100vh - 280px)",
                background: snapshot.isDraggingOver
                  ? "rgba(16,185,129,0.03)"
                  : "transparent",
              }}
              onScroll={(e) => handleScroll(e, colId)}
            >
              {items.map((sub, index) => renderCard(sub, index, colId))}
              {provided.placeholder}

              {loading && items.length === 0 && (
                <div className="py-8 text-center text-muted text-xs animate-pulse">
                  {t("inbox.modal.loading")}
                </div>
              )}

              {!loading && items.length === 0 && (
                <div className="py-8 text-center text-muted text-xs">
                  {t("inbox.kanban.empty_column")}
                </div>
              )}

              {loading && items.length > 0 && (
                <div className="py-3 text-center text-muted text-[10px]">
                  {t("inbox.kanban.loading_more")}
                </div>
              )}
            </div>
          )}
        </Droppable>
      </div>
    );
  };

  // ─── Render: System Filtered Tab ──────────────────────────────────────────

  const renderSystemTab = () => (
    <div
      ref={systemScrollRef}
      className="rounded border overflow-hidden"
      style={{
        background: "var(--bg-secondary)",
        borderColor: "var(--border)",
      }}
      onScroll={(e) => handleScroll(e, "system")}
    >
      {/* Header */}
      <div
        className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-muted border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="col-span-3">{t("inbox.header.track")}</div>
        <div className="col-span-1 text-center">{t("inbox.header.bpm")}</div>
        <div className="col-span-1 text-center">{t("inbox.header.lufs")}</div>
        <div className="col-span-1 text-center">{t("inbox.header.peak")}</div>
        <div className="col-span-1 text-center">{t("inbox.header.crest")}</div>
        <div className="col-span-1 text-center">{t("inbox.header.phase")}</div>
        <div className="col-span-2 text-center">{t("inbox.header.status")}</div>
        <div className="col-span-2 text-right">{t("inbox.header.action")}</div>
      </div>

      {systemItems.length > 0 ? (
        systemItems.map((d) => {
          const badge = statusBadgeColor(d.status);
          return (
            <div
              key={d.id}
              className="grid grid-cols-12 gap-2 px-4 py-3 text-xs items-center border-b cursor-pointer hover:bg-white/[0.02] transition-colors"
              style={{ borderColor: "var(--border-light)" }}
              onClick={() => setDetailModal({ open: true, submission: d })}
            >
              <div className="col-span-3 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate hover:text-emerald-500 transition-colors">
                    {d.track_name || t("inbox.modal.no_name")}
                  </div>
                  <div className="text-[10px] text-muted">
                    {d.producer_name || t("inbox.modal.anonymous")} ·{" "}
                    {formatRelativeTime(d.created_at)}
                  </div>
                </div>
              </div>
              <div className="col-span-1 text-center font-mono">
                {formatBpm(d.bpm)}
              </div>
              <div className="col-span-1 text-center font-mono">
                {formatLufs(d.lufs)}
              </div>
              <div className="col-span-1 text-center font-mono text-muted">
                {formatPeak(d.true_peak)}
              </div>
              <div className="col-span-1 text-center font-mono text-muted">
                {formatCrest(d.crest_factor)}
              </div>
              <div className="col-span-1 text-center font-mono text-muted">
                {d.phase_correlation != null ? d.phase_correlation.toFixed(2) : "—"}
              </div>
              <div className="col-span-2 text-center">
                <span
                  className="font-mono text-[10px] px-2 py-0.5 rounded"
                  style={{ background: badge.bg, color: badge.color }}
                >
                  {t("inbox.auto_rejected_badge")}
                </span>
              </div>
              <div 
                className="col-span-2 text-right flex items-center justify-end gap-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                <TwoClickDelete
                  onDelete={() => handleDelete(d)}
                  size={22}
                />
              </div>
            </div>
          );
        })
      ) : (
        <div className="py-12 text-center text-muted">
          {t("inbox.kanban.empty_system")}
        </div>
      )}

      {systemLoading && systemItems.length > 0 && (
        <div className="py-3 text-center text-muted text-[10px]">
          {t("inbox.kanban.loading_more")}
        </div>
      )}
    </div>
  );

  // ─── Render: Trash Tab ────────────────────────────────────────────────────

  const renderTrashTab = () => (
    <div
      ref={trashScrollRef}
      className="rounded border overflow-hidden"
      style={{
        background: "var(--bg-secondary)",
        borderColor: "var(--border)",
      }}
      onScroll={(e) => handleScroll(e, "trash")}
    >
      {/* Header */}
      <div
        className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-muted border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="col-span-4">{t("inbox.header.track")}</div>
        <div className="col-span-2 text-center">{t("inbox.header.status")}</div>
        <div className="col-span-3 text-center">Eliminado</div>
        <div className="col-span-3 text-right">{t("inbox.header.action")}</div>
      </div>

      {trashItems.length > 0 ? (
        trashItems.map((d) => {
          const deletedAt = d.deleted_at ? new Date(d.deleted_at) : null;
          const hoursAgo = deletedAt
            ? Math.floor(
                (Date.now() - deletedAt.getTime()) / (1000 * 60 * 60)
              )
            : null;
          const canRestore = hoursAgo !== null && hoursAgo < 24;
          const isLoading = actionLoading[d.id];

          return (
            <div
              key={d.id}
              className="grid grid-cols-12 gap-2 px-4 py-3 text-xs items-center border-b cursor-pointer hover:bg-white/[0.02] transition-colors"
              style={{ borderColor: "var(--border-light)", opacity: 0.6 }}
              onClick={() => setDetailModal({ open: true, submission: d })}
            >
              <div className="col-span-4 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate hover:text-emerald-500 transition-colors">
                    {d.track_name || t("inbox.modal.no_name")}
                  </div>
                  <div className="text-[10px] text-muted">
                    {d.producer_name || t("inbox.modal.anonymous")}
                  </div>
                </div>
              </div>
              <div className="col-span-2 text-center">
                <span
                  className="font-mono text-[10px] px-2 py-0.5 rounded"
                  style={{
                    background: "rgba(161,161,170,0.15)",
                    color: "#a1a1aa",
                  }}
                >
                  {statusLabel(d.status, t)}
                </span>
              </div>
              <div className="col-span-3 text-center text-muted text-[11px]">
                {hoursAgo !== null
                  ? hoursAgo < 1
                    ? "Hace menos de 1h"
                    : `Hace ${hoursAgo}h`
                  : "—"}
              </div>
              <div 
                className="col-span-3 text-right flex items-center justify-end gap-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                {canRestore && (
                  <button
                    onClick={() => handleRestore(d)}
                    disabled={!!isLoading}
                    className="px-3 py-1 rounded text-[10px] font-medium disabled:opacity-50 transition-colors hover:bg-white/10"
                    style={{ background: "#06b6d4", color: "#09090b" }}
                  >
                    {isLoading === "restore"
                      ? "..."
                      : t("inbox.kanban.restore")}
                  </button>
                )}
                <button
                  onClick={() => handlePermanentDelete(d)}
                  disabled={!!isLoading}
                  className="px-3 py-1 rounded text-[10px] font-medium disabled:opacity-50 transition-colors hover:bg-white/10"
                  style={{ background: "#ef4444", color: "#fff" }}
                >
                  {isLoading === "delete"
                    ? "..."
                    : "ELIMINAR"}
                </button>
                {!canRestore && (
                  <span
                    className="text-[10px] text-muted"
                    title={t("inbox.kanban.restore_expired")}
                  >
                    Expirado
                  </span>
                )}
              </div>
            </div>
          );
        })
      ) : (
        <div className="py-12 text-center text-muted">
          {t("inbox.kanban.empty_trash")}
        </div>
      )}

      {trashLoading && trashItems.length > 0 && (
        <div className="py-3 text-center text-muted text-[10px]">
          {t("inbox.kanban.loading_more")}
        </div>
      )}
    </div>
  );

  // ─── Main Render ──────────────────────────────────────────────────────────

  const tabs: { key: TabKey; label: string }[] = [
    { key: "kanban", label: t("inbox.kanban_tab") },
    { key: "system", label: role === "dj" ? t("inbox.kanban_dj.auto_rejected_col") : t("inbox.kanban.auto_rejected_col") },
    { key: "trash", label: t("inbox.kanban.trash_tab") },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <h1 className="font-display font-semibold text-xl">
          {role === "dj" ? t("inbox.title_promos") : t("inbox.title_demos")}
        </h1>
      </div>

      {/* Fetch error banner */}
      {fetchError && (
        <div
          className="mb-4 px-4 py-3 rounded border text-xs font-mono"
          style={{
            background: "rgba(239,68,68,0.08)",
            borderColor: "rgba(239,68,68,0.3)",
            color: "#ef4444",
          }}
        >
          <AlertTriangle className="w-4 h-4 inline-block mr-1 -mt-0.5" /> Error cargando datos: {fetchError}
        </div>
      )}

      {/* Tabs */}
      <div className="mb-5 flex gap-1 items-center">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-4 py-1.5 text-sm font-medium rounded transition-colors"
            style={{
              background:
                activeTab === tab.key
                  ? "var(--bg-card-alt)"
                  : "transparent",
              color:
                activeTab === tab.key
                  ? "var(--text-primary)"
                  : "var(--text-muted)",
              border:
                activeTab === tab.key
                  ? "1px solid var(--border)"
                  : "1px solid transparent",
            }}
          >
            <span className="flex items-center gap-2">
              {tab.label}
              {tab.key === "kanban" && (
                (() => {
                  const unreadCount = board.inbox.filter(s => !interactedIds.has(s.id)).length;
                  if (unreadCount === 0) return null;
                  return (
                    <span className="w-4 h-4 flex items-center justify-center rounded-full text-[9px] bg-emerald-500/80 text-black font-bold">
                      {unreadCount}
                    </span>
                  );
                })()
              )}
              {tab.key === "system" && systemItems.length > 0 && !hasSeenSystem && (
                <span className="w-4 h-4 flex items-center justify-center rounded-full text-[9px] bg-red-500/80 text-white font-bold animate-pulse">
                  {systemItems.length}
                </span>
              )}
              {tab.key === "trash" && trashItems.length > 0 && (
                <span className="w-4 h-4 flex items-center justify-center rounded-full text-[9px] bg-zinc-700/80 text-zinc-300 font-bold">
                  {trashItems.length}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "kanban" && (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {renderColumn("inbox", t(role === "dj" ? "inbox.kanban_dj.inbox_col" : "inbox.kanban.inbox_col"), "#06b6d4")}
            {renderColumn(
              "shortlist",
              t(role === "dj" ? "inbox.kanban_dj.shortlist_col" : "inbox.kanban.shortlist_col"),
              "#10b981"
            )}
            {renderColumn(
              "rejected",
              t(role === "dj" ? "inbox.kanban_dj.rejected_col" : "inbox.kanban.rejected_col"),
              "#ef4444"
            )}
          </div>
        </DragDropContext>
      )}

      {activeTab === "system" && renderSystemTab()}
      {activeTab === "trash" && renderTrashTab()}

      {/* ─── Detail Modal ─────────────────────────────────────────────────── */}
      {detailModal.open && detailModal.submission && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(4px)" }}
          onClick={() => setDetailModal({ open: false, submission: null })}
        >
          <div
            className="rounded-lg border max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
            style={{
              borderColor: "var(--border)",
              background: "var(--bg-secondary)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-6 py-4 border-b"
              style={{ borderColor: "var(--border)" }}
            >
              <div>
                <h2 className="font-display font-bold text-lg leading-tight">
                  {detailModal.submission.track_name || t("inbox.modal.no_name")}
                </h2>
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-sm text-muted">
                    {detailModal.submission.producer_name || t("inbox.modal.anonymous")}
                  </p>
                  <ExpirationCountdown createdAt={detailModal.submission.created_at} retentionDays={retentionDays} />
                </div>
              </div>
              <button
                onClick={() => setDetailModal({ open: false, submission: null })}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted hover:text-white hover:bg-white/10 transition-all"
              >
                ✕
              </button>
            </div>

            {(() => {
              const sub = detailModal.submission;
              if (!sub) return null;
              
              const rules = sonicSignature?.auto_reject_rules || {};
              
              // Calculate failures on the fly (for old tracks or if backend reason is generic)
              const bpmMin = sonicSignature?.bpm_min ?? 70;
              const bpmMax = sonicSignature?.bpm_max ?? 180;
              const lufsLimit = (sonicSignature?.lufs_target ?? -14) + (sonicSignature?.lufs_tolerance ?? 2);
              const phaseMin = sonicSignature?.phase_correlation_min ?? 0;
              
              // Normalize rule keys — DB may store short keys (tempo/phase/lufs) or long ones
              const isBpmFailed = (rules.reject_out_of_tempo || rules.tempo) && sub.bpm !== null && (sub.bpm < bpmMin || sub.bpm > bpmMax);
              const isLufsFailed = (rules.reject_excessive_loudness || rules.lufs) && sub.lufs !== null && (sub.lufs > lufsLimit);
              const isPhaseFailed = (rules.reject_inverted_phase || rules.phase) && sub.phase_correlation !== null && (sub.phase_correlation <= phaseMin);
              const isCrestFailed = (rules.reject_low_dynamic_range) && sub.crest_factor !== null && (sub.crest_factor < (sonicSignature?.crest_factor_min ?? 5.0));
              const isKeyFailed = (rules.reject_wrong_key) && sub.musical_key && sonicSignature?.target_camelot_keys?.length > 0 && !sonicSignature.target_camelot_keys.includes(sub.musical_key);

              // Determine the "primary" failure if the backend reason is missing
              let displayReason = sub.rejection_reason;
              if (!displayReason && sub.status === "auto_rejected") {
                if (isBpmFailed) displayReason = "out_of_tempo";
                else if (isLufsFailed) displayReason = "excessive_loudness";
                else if (isPhaseFailed) displayReason = "inverted_phase";
                else if (isCrestFailed) displayReason = "low_dynamic_range";
                else if (isKeyFailed) displayReason = "wrong_musical_key";
              }

              return (
                <div className="flex-1 overflow-y-auto p-6 space-y-8">
                  {/* Main metrics grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div 
                      className={cn(
                        "p-3 rounded border transition-all",
                        isBpmFailed ? "bg-red-500/10 border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.1)]" : "bg-white/[0.02] border-zinc-800"
                      )}
                      title={isBpmFailed ? `Límite: ${bpmMin}-${bpmMax} BPM` : (sonicSignature ? `Config: ${bpmMin}-${bpmMax} BPM` : "")}
                    >
                      <p className={cn("text-[10px] uppercase tracking-wider mb-1 font-mono", isBpmFailed ? "text-red-400 font-bold" : "text-muted")}>{t("inbox.header.bpm")}</p>
                      <p className={cn("text-xl font-display font-semibold", isBpmFailed ? "text-red-500" : "")}>{formatBpm(sub.bpm)}</p>
                    </div>
                    <div 
                      className={cn(
                        "p-3 rounded border transition-all",
                        isLufsFailed ? "bg-red-500/10 border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.1)]" : "bg-white/[0.02] border-zinc-800"
                      )}
                      title={isLufsFailed ? `Máximo permitido: ${lufsLimit} LUFS` : (sonicSignature ? `Config: ${lufsLimit} LUFS` : "")}
                    >
                      <p className={cn("text-[10px] uppercase tracking-wider mb-1 font-mono", isLufsFailed ? "text-red-400 font-bold" : "text-muted")}>{t("inbox.header.lufs")}</p>
                      <p className={cn("text-xl font-display font-semibold", isLufsFailed ? "text-red-500" : "")}>{formatLufs(sub.lufs)}</p>
                    </div>
                    <div className={cn(
                      "p-3 rounded border transition-all",
                      isKeyFailed ? "bg-red-500/10 border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.1)]" : "bg-white/[0.02] border-zinc-800"
                    )}>
                      <p className={cn("text-[10px] uppercase tracking-wider mb-1 font-mono", isKeyFailed ? "text-red-400 font-bold" : "text-muted")}>Tonalidad</p>
                      <p className={cn("text-xl font-display font-semibold", isKeyFailed ? "text-red-500" : "")}>{formatKey(sub.musical_key)}</p>
                    </div>
                    <div className="p-3 rounded border bg-white/[0.02] border-zinc-800">
                      <p className="text-[10px] uppercase tracking-wider text-muted mb-1 font-mono">Duración</p>
                      <p className="text-xl font-display font-semibold">{formatDuration(sub.duration)}</p>
                    </div>
                  </div>

                  {/* Technical breakdown */}
                  <div className="space-y-3">
                    <h3 className="text-xs font-mono uppercase tracking-widest text-muted border-b pb-1.5" style={{ borderColor: "var(--border)" }}>
                      Análisis Técnico
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                      <div className="flex justify-between items-center text-sm py-1 border-b border-white/[0.03]">
                        <span className="text-muted">{t("inbox.header.peak")}</span>
                        <span className="font-mono">{formatPeak(sub.true_peak)} dB</span>
                      </div>
                      <div className={cn("flex justify-between items-center text-sm py-1 border-b border-white/[0.03] px-1 rounded", isCrestFailed ? "bg-red-500/10" : "")}>
                        <span className={isCrestFailed ? "text-red-400" : "text-muted"}>{t("inbox.header.crest")}</span>
                        <span className={cn("font-mono", isCrestFailed ? "text-red-500" : "")}>{formatCrest(sub.crest_factor)} dB</span>
                      </div>
                      <div 
                        className={cn("flex justify-between items-center text-sm py-1 border-b border-white/[0.03] transition-colors px-1 rounded", isPhaseFailed ? "bg-red-500/10" : "")}
                        title={isPhaseFailed ? `Mínimo permitido: ${phaseMin}` : ""}
                      >
                        <span className={isPhaseFailed ? "text-red-400 font-bold" : "text-muted"}>Correlación de Fase</span>
                        <span className={cn("font-mono", isPhaseFailed ? "text-red-500" : "")}>{sub.phase_correlation?.toFixed(2) ?? "—"}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm py-1 border-b border-white/[0.03]">
                        <span className="text-muted">Estado Actual</span>
                        <span className="font-mono" style={{ color: statusBadgeColor(sub.status).color }}>
                          {statusLabel(sub.status, t).toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Information & Notes */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                    <div className="space-y-3">
                      <h3 className="text-xs font-mono uppercase tracking-widest text-muted border-b pb-1.5" style={{ borderColor: "var(--border)" }}>
                        Contacto
                      </h3>
                      <div className="space-y-2">
                        <p className="text-sm">
                          <span className="text-muted block text-[10px] uppercase mb-0.5">Email del productor</span>
                          {sub.producer_email || t("crm.no_email")}
                        </p>
                        <p className="text-sm">
                          <span className="text-muted block text-[10px] uppercase mb-0.5">Recibido</span>
                          {new Date(sub.created_at).toLocaleString("es-AR")}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h3 className="text-xs font-mono uppercase tracking-widest text-muted border-b pb-1.5" style={{ borderColor: "var(--border)" }}>
                        Notas del Productor
                      </h3>
                      <p className="text-sm text-secondary italic leading-relaxed">
                        {sub.notes || "No se adjuntaron notas."}
                      </p>
                    </div>
                  </div>

                  {/* Rejection reason (if any) */}
                  {(displayReason || sub.status === "auto_rejected") && (
                    <div className="p-4 rounded-lg bg-red-500/5 border border-red-500/20 shadow-[inset_0_0_20px_rgba(239,68,68,0.05)]">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-red-500" />
                        <h3 className="text-[10px] font-mono uppercase tracking-widest text-red-400">
                          {t("inbox.auto_rejected_title")}
                        </h3>
                      </div>
                      <p className="text-sm text-red-200/90 leading-relaxed font-medium">
                        {(() => {
                          if (displayReason === "out_of_tempo") return `BPM fuera de rango. El track tiene ${sub.bpm} BPM y tu firma requiere entre ${bpmMin} y ${bpmMax} BPM.`;
                          if (displayReason === "excessive_loudness") return `Volumen excesivo. El track mide ${sub.lufs} LUFS y tu límite máximo es ${lufsLimit} LUFS.`;
                          if (displayReason === "inverted_phase") return `Falla de fase. La correlación es de ${sub.phase_correlation?.toFixed(2)}, por debajo del mínimo de ${phaseMin}.`;
                          if (displayReason === "wrong_musical_key") return `Tonalidad incorrecta. El track está en ${formatKey(sub.musical_key)} y no coincide con tus escalas preferidas.`;
                          if (displayReason === "digital_clipping") return `Clipping digital. El True Peak alcanzó ${sub.true_peak} dB (máximo permitido: < 0 dB).`;
                          if (displayReason === "low_dynamic_range") return `Rango dinámico insuficiente. El Crest Factor es de ${sub.crest_factor} dB (mínimo: ${sonicSignature?.crest_factor_min ?? 5.0} dB).`;
                          return displayReason || t("inbox.auto_rejected_reason");
                        })()}
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Footer Actions */}
            <div className="px-6 py-4 border-t bg-white/[0.01] flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2">
                {detailModal.submission.mp3_path && (
                  <button
                    onClick={() => handleListen(detailModal.submission!)}
                    className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all hover:scale-105 active:scale-95"
                    style={{ 
                      background: currentTrack?.id === detailModal.submission.id && isPlaying ? "#ef4444" : "#10b981", 
                      color: "#09090b" 
                    }}
                  >
                    {currentTrack?.id === detailModal.submission.id && isPlaying ? (
                      <><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg> PAUSAR</>
                    ) : (
                      <><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg> ESCUCHAR</>
                    )}
                  </button>
                )}
                {detailModal.submission.producer_email && (
                  <Link
                    href={`/crm?highlight=${detailModal.submission.id}`}
                    className="px-4 py-2 rounded-full text-sm font-medium border border-white/10 hover:bg-white/5 transition-colors"
                  >
                    CONTACTAR
                  </Link>
                )}
              </div>

              <div className="flex items-center gap-3">
                {detailModal.submission.status === "inbox" && (
                  <>
                    <button
                      onClick={() => { updateStatus(detailModal.submission!, "rejected"); setDetailModal({ open: false, submission: null }); }}
                      className="text-[10px] font-bold text-red-500 hover:underline uppercase tracking-widest"
                    >
                      {t("inbox.kanban.reject")}
                    </button>
                    <button
                      onClick={() => { updateStatus(detailModal.submission!, "shortlist"); setDetailModal({ open: false, submission: null }); }}
                      className="text-[10px] font-bold text-emerald-500 hover:underline uppercase tracking-widest"
                    >
                      {t("inbox.kanban.approve")}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Email Modal ─────────────────────────────────────────────────── */}
      {emailModal.open && emailModal.submission && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={closeEmailModal}
        >
          <div
            className="rounded border max-w-lg w-full mx-4 overflow-hidden"
            style={{
              borderColor: "var(--border)",
              background: "var(--bg-secondary)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: "var(--border)" }}
            >
              <h2 className="font-display font-semibold text-base">
                {t("inbox.kanban.email_title").replace(
                  "{producer_name}",
                  emailModal.submission.producer_name ||
                    t("inbox.modal.anonymous")
                )}
              </h2>
              <button
                onClick={closeEmailModal}
                className="w-7 h-7 rounded flex items-center justify-center text-muted hover:text-white transition-colors"
                style={{ background: "var(--bg-card-alt)" }}
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {emailModal.sent && (
                <div className="py-6 text-center text-sm" style={{ color: "#10b981" }}>
                  {t("inbox.kanban.email_sent_success")}
                </div>
              )}

              {!emailModal.sent && (
                <>
                  {/* Template selector */}
                  <div>
                    <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">
                      Plantilla
                    </label>
                    <select
                      value={emailModal.selectedTemplate}
                      onChange={(e) => handleTemplateChange(e.target.value)}
                      className="w-full rounded px-3 py-2 text-sm border"
                      style={{
                        background: "var(--bg-card)",
                        borderColor: "var(--border)",
                        color: "var(--text-primary)",
                      }}
                    >
                      <option value="">
                        {emailModal.sending ? t("inbox.kanban.email_sending") : emailModal.templates.length === 0 ? t("inbox.kanban.no_templates_crm") : t("inbox.kanban.select_template")}
                      </option>
                      {emailModal.templates.map((tmpl) => (
                        <option key={tmpl.id} value={tmpl.id}>
                          {tmpl.name}
                        </option>
                      ))}
                    </select>
                    {emailModal.templates.length === 0 && !emailModal.sending && (
                      <Link href="/crm" className="text-[10px] text-emerald-500 hover:underline mt-1 inline-block">
                        Ir a CRM para crear plantillas
                      </Link>
                    )}
                  </div>

                  {/* Subject */}
                  <div>
                    <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">
                      {t("inbox.kanban.email_subject")}
                    </label>
                    <input
                      type="text"
                      value={emailModal.subject}
                      onChange={(e) =>
                        setEmailModal((p) => ({
                          ...p,
                          subject: e.target.value,
                        }))
                      }
                      className="w-full rounded px-3 py-2 text-sm border"
                      style={{
                        background: "var(--bg-card)",
                        borderColor: "var(--border)",
                        color: "var(--text-primary)",
                      }}
                    />
                  </div>

                  {/* Body */}
                  <div>
                    <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">
                      {t("inbox.kanban.email_body")}
                    </label>
                    <textarea
                      value={emailModal.body}
                      onChange={(e) =>
                        setEmailModal((p) => ({
                          ...p,
                          body: e.target.value,
                        }))
                      }
                      rows={6}
                      className="w-full rounded px-3 py-2 text-sm border resize-none"
                      style={{
                        background: "var(--bg-card)",
                        borderColor: "var(--border)",
                        color: "var(--text-primary)",
                      }}
                    />
                  </div>

                  {/* Error */}
                  {emailModal.error && (
                    <div
                      className="rounded px-3 py-2 text-xs text-center"
                      style={{
                        background: "rgba(239,68,68,0.1)",
                        color: "#ef4444",
                      }}
                    >
                      {emailModal.error}
                    </div>
                  )}

                  {/* Buttons */}
                  <div className="flex items-center gap-2 justify-end pt-2">
                    <button
                      onClick={closeEmailModal}
                      className="px-4 py-2 rounded text-sm font-medium transition-colors hover:bg-white/10"
                      style={{
                        background: "var(--bg-card-alt)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {t("inbox.kanban.email_skip")}
                    </button>
                    <button
                      onClick={handleSendEmail}
                      disabled={emailModal.sending}
                      className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50 transition-colors"
                      style={{
                        background: "#10b981",
                        color: "#09090b",
                      }}
                    >
                      {emailModal.sending
                        ? t("inbox.kanban.email_sending")
                        : t("inbox.kanban.email_send")}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Rejection Reason Modal ──────────────────────────────────────── */}
      {pendingReject && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setPendingReject(null)}
        >
          <div
            className="rounded border max-w-md w-full mx-4 overflow-hidden"
            style={{
              borderColor: "var(--border)",
              background: "var(--bg-secondary)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: "var(--border)" }}
            >
              <h2 className="font-display font-semibold text-base">
                {t("inbox.kanban.reject")} —{" "}
                {pendingReject.sub.track_name || t("inbox.modal.no_name")}
              </h2>
              <button
                onClick={() => setPendingReject(null)}
                className="w-7 h-7 rounded flex items-center justify-center text-muted hover:text-white transition-colors"
                style={{ background: "var(--bg-card-alt)" }}
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">
                  {t("inbox.kanban.rejection_reason_placeholder")}
                </label>
                <textarea
                  value={pendingReject.reason}
                  onChange={(e) =>
                    setPendingReject((p) =>
                      p ? { ...p, reason: e.target.value } : null
                    )
                  }
                  rows={3}
                  className="w-full rounded px-3 py-2 text-sm border resize-none"
                  style={{
                    background: "var(--bg-card)",
                    borderColor: "var(--border)",
                    color: "var(--text-primary)",
                  }}
                  placeholder={t(
                    "inbox.kanban.rejection_reason_placeholder"
                  )}
                />
              </div>

              <div className="flex items-center gap-2 justify-end pt-2">
                <button
                  onClick={() => setPendingReject(null)}
                  className="px-4 py-2 rounded text-sm font-medium transition-colors hover:bg-white/10"
                  style={{
                    background: "var(--bg-card-alt)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {t("inbox.kanban.email_skip")}
                </button>
                <button
                  onClick={handleRejectSubmit}
                  className="px-4 py-2 rounded text-sm font-medium transition-colors"
                  style={{ background: "#ef4444", color: "#fff" }}
                >
                  {t("inbox.kanban.reject")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Permanent Delete Confirmation Modal ───────────────────────────────── */}
      {confirmModal.open && confirmModal.submission && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !confirmModal.loading && setConfirmModal({ open: false, submission: null, loading: false })} />
          <div className="relative w-full max-w-md rounded-xl border p-6 shadow-2xl animate-in zoom-in-95 duration-200" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
            <div className="flex items-center gap-3 mb-4 text-red-500">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(239,68,68,0.1)" }}>
                <Trash2 className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-semibold">{t("inbox.kanban.delete_confirm_title")}</h2>
            </div>
            
            <p className="text-sm text-muted mb-6 leading-relaxed">
              {t("inbox.kanban.delete_confirm_desc")} <span className="text-primary font-medium">"{confirmModal.submission.track_name}"</span>.
              <span className="block mt-2 font-medium text-red-400">{t("inbox.kanban.delete_confirm_warning")}</span>
            </p>

            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => setConfirmModal({ open: false, submission: null, loading: false })}
                disabled={confirmModal.loading}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-white/5"
                style={{ color: "var(--text-secondary)" }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmPermanentDelete}
                disabled={confirmModal.loading}
                className="px-5 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                style={{ background: "#ef4444", color: "#fff" }}
              >
                {confirmModal.loading ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    Eliminando...
                  </>
                ) : (
                  "Sí, eliminar todo"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
