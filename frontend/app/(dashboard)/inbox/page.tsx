"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  mp3_path: string | null;
  original_path: string | null;
  human_email_sent?: boolean;
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

function replaceVariables(
  template: string,
  sub: SubmissionSummary
): string {
  return template
    .replace(/\{producer_name\}/g, sub.producer_name || "Productor")
    .replace(/\{track_name\}/g, sub.track_name || "Track")
    .replace(/\{producer\}/g, sub.producer_name || "Productor")
    .replace(/\{track\}/g, sub.track_name || "Track");
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InboxPage() {
  return <InboxContent />;
}

function InboxContent() {
  const { t } = useLanguage();
  const { playTrack, togglePlay, isPlaying, currentTrack } = usePlayer();
  const searchParams = useSearchParams();
  const highlightParam = searchParams.get("highlight");

  const [activeTab, setActiveTab] = useState<TabKey>("kanban");

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

  // ─── Fetch helpers ────────────────────────────────────────────────────────

  const fetchColumn = useCallback(
    async (column: "inbox" | "shortlist" | "rejected", append = false) => {
      const statusMap = {
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
          { credentials: "include" }
        );
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data: SubmissionSummary[] = await res.json();
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
      } catch {
        // silent
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
          { credentials: "include" }
        );
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data: SubmissionSummary[] = await res.json();
        setSystemItems((prev) => (append ? [...prev, ...data] : data));
        setSystemOffset(append ? offset + data.length : data.length);
        setSystemHasMore(data.length === PAGE_SIZE);
      } catch {
        // silent
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
          `/api/submissions?offset=${offset}&limit=${PAGE_SIZE}`,
          { credentials: "include" }
        );
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data: SubmissionSummary[] = await res.json();
        // Filter to only deleted items (backend may return all)
        const deleted = data.filter((d) => d.deleted_at);
        setTrashItems((prev) => (append ? [...prev, ...deleted] : deleted));
        setTrashOffset(append ? offset + deleted.length : deleted.length);
        setTrashHasMore(deleted.length === PAGE_SIZE);
      } catch {
        // silent
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
      alert(e instanceof Error ? e.message : t("inbox.error_unknown"));
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
    try {
      const res = await fetch(`/api/submissions/${sub.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      // Remove from board
      setBoard((prev) => {
        const next = { ...prev };
        for (const col of ["inbox", "shortlist", "rejected"] as const) {
          next[col] = next[col].filter((s) => s.id !== sub.id);
        }
        return next;
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : t("inbox.error_unknown"));
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
      // Refresh inbox column
      setBoardOffsets((prev) => ({ ...prev, inbox: 0 }));
      setBoardHasMore((prev) => ({ ...prev, inbox: true }));
      fetchColumn("inbox");
    } catch (e) {
      alert(e instanceof Error ? e.message : t("inbox.error_unknown"));
    } finally {
      setActionLoading((p) => {
        const next = { ...p };
        delete next[sub.id];
        return next;
      });
    }
  };

  // ─── Listen ───────────────────────────────────────────────────────────────

  const handleListen = (sub: SubmissionSummary) => {
    if (!sub.mp3_path) return;
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
      alert(t("inbox.kanban.rejection_reason_required"));
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
            {/* Drag handle strip */}
            <div
              className="cursor-grab active:cursor-grabbing"
              {...provided.dragHandleProps}
              style={{
                height: "4px",
                borderTop: "2px dashed var(--border)",
                background: "rgba(255,255,255,0.02)",
              }}
            />

            {/* Top row */}
            <div className="flex items-start gap-2 px-3 pt-2.5">
              {/* Grip icon */}
              <div
                className="mt-0.5 cursor-grab active:cursor-grabbing flex-shrink-0"
                style={{ color: "var(--text-muted)" }}
              >
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
                <div className="font-medium text-sm truncate">
                  {sub.track_name || t("inbox.modal.no_name")}
                </div>
                <div className="text-[11px] text-muted mt-0.5">
                  {sub.producer_name || t("inbox.modal.anonymous")}
                </div>
              </div>
            </div>

            {/* Metrics row */}
            <div className="flex items-center gap-3 px-3 py-1.5 text-[11px] font-mono">
              <span>{formatBpm(sub.bpm)} BPM</span>
              <span>{formatLufs(sub.lufs)} LUFS</span>
              <span>{formatKey(sub.musical_key)}</span>
            </div>

            {/* Badges row */}
            <div className="flex items-center gap-1.5 px-3 pb-1.5">
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
                  className="w-6 h-6 rounded flex items-center justify-center transition-colors hover:bg-white/10"
                  style={{ color: "#10b981" }}
                  title="Ver en CRM"
                >
                  📧
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
        <div className="col-span-1 text-center">{t("inbox.header.dur")}</div>
        <div className="col-span-1 text-center">{t("inbox.header.phase")}</div>
        <div className="col-span-1 text-center">{t("inbox.header.key")}</div>
        <div className="col-span-2 text-center">{t("inbox.header.status")}</div>
        <div className="col-span-2 text-right">{t("inbox.header.action")}</div>
      </div>

      {systemItems.length > 0 ? (
        systemItems.map((d) => {
          const badge = statusBadgeColor(d.status);
          return (
            <div
              key={d.id}
              className="grid grid-cols-12 gap-2 px-4 py-3 text-xs items-center border-b"
              style={{ borderColor: "var(--border-light)" }}
            >
              <div className="col-span-3 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">
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
                {d.duration != null
                  ? `${Math.floor(d.duration / 60)}:${Math.floor(d.duration % 60)
                      .toString()
                      .padStart(2, "0")}`
                  : "—"}
              </div>
              <div className="col-span-1 text-center font-mono text-muted">—</div>
              <div className="col-span-1 text-center font-mono text-muted">
                {formatKey(d.musical_key)}
              </div>
              <div className="col-span-2 text-center">
                <span
                  className="font-mono text-[10px] px-2 py-0.5 rounded"
                  style={{ background: badge.bg, color: badge.color }}
                >
                  Auto-rechazado
                </span>
              </div>
              <div className="col-span-2 text-right flex items-center justify-end gap-1.5">
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
              className="grid grid-cols-12 gap-2 px-4 py-3 text-xs items-center border-b"
              style={{ borderColor: "var(--border-light)", opacity: 0.6 }}
            >
              <div className="col-span-4 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">
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
              <div className="col-span-3 text-right flex items-center justify-end gap-1.5">
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
    { key: "system", label: t("inbox.kanban.system_tab") },
    { key: "trash", label: t("inbox.kanban.trash_tab") },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <h1 className="font-display font-semibold text-xl">
          {t("inbox.title")}
        </h1>
      </div>

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
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "kanban" && (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {renderColumn("inbox", t("inbox.kanban.inbox_col"), "#06b6d4")}
            {renderColumn(
              "shortlist",
              t("inbox.kanban.shortlist_col"),
              "#10b981"
            )}
            {renderColumn(
              "rejected",
              t("inbox.kanban.rejected_col"),
              "#ef4444"
            )}
          </div>
        </DragDropContext>
      )}

      {activeTab === "system" && renderSystemTab()}
      {activeTab === "trash" && renderTrashTab()}

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
                        {t("inbox.kanban.no_templates")}
                      </option>
                      {emailModal.templates.map((tmpl) => (
                        <option key={tmpl.id} value={tmpl.id}>
                          {tmpl.name}
                        </option>
                      ))}
                    </select>
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
    </div>
  );
}
