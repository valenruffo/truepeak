"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { usePlayer } from "@/lib/PlayerContext";
import TwoClickDelete from "@/components/TwoClickDelete";
import { useLanguage } from "@/lib/i18n";
import { KanbanFilterBar } from "@/components/dashboard/kanban-filter-bar";
import { useKanbanFilters, filterSubmissions } from "@/store/kanban-filters";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import { Clock, Mail, AlertTriangle, Trash2, RotateCcw, X } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useUndoableState, useUndoRedoKey } from "@/lib/useUndoableState";

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
  hq_downloaded?: boolean;
  rejection_reason?: string | null;
  notes?: string | null;
  producer_instagram?: string | null;
  producer_soundcloud?: string | null;
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

function cleanHtmlToPlainText(html: string): string {
  if (!html) return "";
  if (!html.includes("<") && !html.includes(">")) {
    return html;
  }
  let text = html;
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>\s*<p>/gi, "\n\n");
  text = text.replace(/<\/div>\s*<div>/gi, "\n\n");
  text = text.replace(/<[^>]*>/g, "");
  text = text.replace(/&amp;/g, "&")
             .replace(/&lt;/g, "<")
             .replace(/&gt;/g, ">")
             .replace(/&quot;/g, '"')
             .replace(/&#039;/g, "'");
  return text.trim();
}

function replaceVariables(
  template: string,
  sub: SubmissionSummary,
  labelName: string
): string {
  return resolvePlaceholders(template, sub, labelName);
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

const variables = [
  { key: "{producer}", label: "Productor", desc: "Nombre del productor" },
  { key: "{track}", label: "Track", desc: "Nombre del track" },
  { key: "{bpm}", label: "BPM", desc: "Tempo del track" },
  { key: "{label}", label: "Sello", desc: "Nombre del sello" },
];

const escapeHtml = (str: string) => {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const convertTextToHtml = (text: string, sub: SubmissionSummary | null, labelName: string) => {
  if (!text) return "";
  
  let html = escapeHtml(text);

  const name = sub ? sub.producer_name : "Productor";
  const trackName = sub ? sub.track_name : "Track";
  const bpmValue = sub ? (sub.bpm ? String(Math.round(sub.bpm)) : "—") : "BPM";
  const labelVal = labelName || "Sello";

  const badges: Record<string, string> = {
    "{producer}": `<span contenteditable="false" class="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium mx-0.5 border border-emerald-500/20 select-all" data-variable="{producer}">${escapeHtml(name)}</span>`,
    "{track}": `<span contenteditable="false" class="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium mx-0.5 border border-emerald-500/20 select-all" data-variable="{track}">${escapeHtml(trackName)}</span>`,
    "{bpm}": `<span contenteditable="false" class="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium mx-0.5 border border-emerald-500/20 select-all" data-variable="{bpm}">${escapeHtml(bpmValue)}</span>`,
    "{label}": `<span contenteditable="false" class="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium mx-0.5 border border-emerald-500/20 select-all" data-variable="{label}">${escapeHtml(labelVal)}</span>`
  };

  Object.entries(badges).forEach(([placeholder, badgeHtml]) => {
    const regex = new RegExp(placeholder.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
    html = html.replace(regex, badgeHtml);
  });

  return html.replace(/\n/g, "<br>");
};

const convertHtmlToText = (html: string) => {
  if (typeof document === "undefined") return html;
  const temp = document.createElement("div");
  temp.innerHTML = html;
  
  const badges = temp.querySelectorAll("span[data-variable]");
  badges.forEach((badge) => {
    const variable = badge.getAttribute("data-variable");
    if (variable) {
      badge.replaceWith(document.createTextNode(variable));
    }
  });

  let text = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === "BR") {
        text += "\n";
      } else if (el.tagName === "DIV" || el.tagName === "P") {
        if (text && !text.endsWith("\n")) {
          text += "\n";
        }
        el.childNodes.forEach(walk);
        if (text && !text.endsWith("\n")) {
          text += "\n";
        }
      } else {
        el.childNodes.forEach(walk);
      }
    }
  };
  
  temp.childNodes.forEach(walk);
  return text.replace(/\r\n/g, "\n");
};

const updateDragCaret = (e: React.DragEvent, container: HTMLDivElement) => {
  const existing = document.getElementById("tp-drag-caret");
  if (existing) {
    existing.remove();
  }

  let range: Range | null = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(e.clientX, e.clientY);
  } else if (e.nativeEvent && (e.nativeEvent as any).rangeParent) {
    const ne = e.nativeEvent as any;
    range = document.createRange();
    range.setStart(ne.rangeParent, ne.rangeOffset);
  }

  if (range && container.contains(range.commonAncestorContainer)) {
    const caret = document.createElement("span");
    caret.id = "tp-drag-caret";
    caret.className = "inline-block w-[3px] h-[1.2em] bg-emerald-400 align-middle animate-pulse mx-0.5 pointer-events-none rounded";
    caret.style.marginTop = "-2px";
    
    try {
      range.insertNode(caret);
    } catch (err) {
      container.appendChild(caret);
    }
  }
};

const removeDragCaret = () => {
  const existing = document.getElementById("tp-drag-caret");
  if (existing) {
    existing.remove();
  }
};

function resolvePlaceholders(text: string, sub: SubmissionSummary, labelName: string): string {
  if (!text) return "";
  return text
    .replace(/\{producer_name\}/g, sub.producer_name || "Productor")
    .replace(/\{track_name\}/g, sub.track_name || "Track")
    .replace(/\{producer\}/g, sub.producer_name || "Productor")
    .replace(/\{track\}/g, sub.track_name || "Track")
    .replace(/\{bpm\}/g, sub.bpm ? String(Math.round(sub.bpm)) : "—")
    .replace(/\{label\}/g, labelName || "Sello");
}

function statusLabel(status: string, role: "label" | "dj", t: (key: any) => string): string {
  const prefix = role === "dj" ? "inbox.kanban_dj" : "inbox.kanban";
  switch (status) {
    case "inbox":
    case "pending":
      return t(`${prefix}.inbox_col`);
    case "shortlist":
    case "approved":
      return t(`${prefix}.shortlist_col`);
    case "rejected":
      return t(`${prefix}.rejected_col`);
    case "auto_rejected":
      return t(`${prefix}.auto_rejected_col`);
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
    <Suspense fallback={<div className="w-full max-w-[1700px] mx-auto px-6 py-8"><div className="animate-pulse h-96 rounded" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }} /></div>}>
      <InboxContent />
    </Suspense>
  );
}

function InboxContent() {
  const { lang, t } = useLanguage();
  const filters = useKanbanFilters();
  const { playTrack, togglePlay, isPlaying, currentTrack } = usePlayer();
  const { addToast } = useToast();
  const searchParams = useSearchParams();
  const highlightParam = searchParams.get("highlight");

  const [activeTab, setActiveTab] = useState<TabKey>("kanban");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [viewMode, setViewMode] = useState<"kanban" | "list">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("inboxViewMode");
      if (saved === "kanban" || saved === "list") return saved;
    }
    return "kanban";
  });

  useEffect(() => {
    localStorage.setItem("inboxViewMode", viewMode);
  }, [viewMode]);

  // Role for dynamic i18n keys
  const [role, setRole] = useState<"label" | "dj">("label");

  // Label name state
  const [labelName, setLabelName] = useState<string>("");

  // Undoable states for email subject and body
  const emailBodyState = useUndoableState("");
  const emailSubjectState = useUndoableState("");
  const { value: emailBody, set: setEmailBody, undo: undoEmailBody, redo: redoEmailBody } = emailBodyState;
  const { value: emailSubject, set: setEmailSubject, undo: undoEmailSubject, redo: redoEmailSubject } = emailSubjectState;

  const emailBodyDivRef = useRef<HTMLDivElement | null>(null);
  const lastSyncedTextRef = useRef("");
  const lastSyncedContactRef = useRef<SubmissionSummary | null>(null);
  const lastSyncedLabelRef = useRef("");

  const emailSubjectDivRef = useRef<HTMLDivElement | null>(null);
  const lastSyncedSubjectTextRef = useRef("");
  const lastSyncedSubjectContactRef = useRef<SubmissionSummary | null>(null);
  const lastSyncedSubjectLabelRef = useRef("");

  const [lastActiveField, setLastActiveField] = useState<"body" | "subject">("body");
  const [dragOverField, setDragOverField] = useState<"email-body" | "email-subject" | null>(null);



  const insertEmailVariable = (variable: string, field: "body" | "subject") => {
    const divRef = field === "subject" ? emailSubjectDivRef : emailBodyDivRef;
    if (divRef.current) {
      divRef.current.focus();
      const sel = window.getSelection();
      let range: Range | null = null;
      
      if (sel && sel.rangeCount > 0) {
        const potentialRange = sel.getRangeAt(0);
        if (divRef.current.contains(potentialRange.commonAncestorContainer)) {
          range = potentialRange;
        }
      }
      
      if (!range) {
        range = document.createRange();
        range.selectNodeContents(divRef.current);
        range.collapse(false);
      }
      
      const name = emailModal.submission ? emailModal.submission.producer_name : "Productor";
      const trackName = emailModal.submission ? emailModal.submission.track_name : "Track";
      const bpmValue = emailModal.submission ? (emailModal.submission.bpm ? String(Math.round(emailModal.submission.bpm)) : "—") : "BPM";
      const labelVal = labelName || "Sello";

      let textToShow = "";
      if (variable === "{producer}") textToShow = name;
      else if (variable === "{track}") textToShow = trackName;
      else if (variable === "{bpm}") textToShow = bpmValue;
      else if (variable === "{label}") textToShow = labelVal;

      const span = document.createElement("span");
      span.setAttribute("contenteditable", "false");
      span.setAttribute("data-variable", variable);
      span.className = "inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium mx-0.5 border border-emerald-500/20 select-all";
      span.textContent = textToShow;

      range.insertNode(span);
      range.setStartAfter(span);
      range.setEndAfter(span);
      
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      
      const html = divRef.current.innerHTML;
      const text = convertHtmlToText(html);
      
      if (field === "subject") {
        lastSyncedSubjectTextRef.current = text;
        setEmailSubject(text);
      } else {
        lastSyncedTextRef.current = text;
        setEmailBody(text);
      }
    }
  };

  const handleDragStart = (e: React.DragEvent, variable: string) => {
    e.dataTransfer.setData("text/plain", variable);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleEmailBodyInput = (e: React.FormEvent<HTMLDivElement>) => {
    const html = e.currentTarget.innerHTML;
    const text = convertHtmlToText(html);
    lastSyncedTextRef.current = text;
    setEmailBody(text);
  };

  const handleEmailBodyDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOverField("email-body");
    if (emailBodyDivRef.current) {
      updateDragCaret(e, emailBodyDivRef.current);
    }
  };

  const handleEmailBodyDragLeave = () => {
    setDragOverField(null);
    removeDragCaret();
  };

  const handleEmailBodyDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOverField(null);
    removeDragCaret();
    const variable = e.dataTransfer.getData("text/plain");
    
    if (variable && variables.some(v => v.key === variable)) {
      let range: Range | null = null;
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(e.clientX, e.clientY);
      } else if (e.nativeEvent && (e.nativeEvent as any).rangeParent) {
        const ne = e.nativeEvent as any;
        range = document.createRange();
        range.setStart(ne.rangeParent, ne.rangeOffset);
      }

      if (range) {
        const name = emailModal.submission ? emailModal.submission.producer_name : "Productor";
        const trackName = emailModal.submission ? emailModal.submission.track_name : "Track";
        const bpmValue = emailModal.submission ? (emailModal.submission.bpm ? String(Math.round(emailModal.submission.bpm)) : "—") : "BPM";
        const labelVal = labelName || "Sello";

        let textToShow = "";
        if (variable === "{producer}") textToShow = name;
        else if (variable === "{track}") textToShow = trackName;
        else if (variable === "{bpm}") textToShow = bpmValue;
        else if (variable === "{label}") textToShow = labelVal;

        const span = document.createElement("span");
        span.setAttribute("contenteditable", "false");
        span.setAttribute("data-variable", variable);
        span.className = "inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium mx-0.5 border border-emerald-500/20 select-all";
        span.textContent = textToShow;

        range.insertNode(span);
        range.setStartAfter(span);
        range.setEndAfter(span);
        
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }

        const html = e.currentTarget.innerHTML;
        const text = convertHtmlToText(html);
        lastSyncedTextRef.current = text;
        setEmailBody(text);
      }
    }
  };

  const handleEmailSubjectInput = (e: React.FormEvent<HTMLDivElement>) => {
    const html = e.currentTarget.innerHTML;
    const text = convertHtmlToText(html);
    lastSyncedSubjectTextRef.current = text;
    setEmailSubject(text);
  };

  const handleEmailSubjectKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
    }
  };

  const handleEmailSubjectDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOverField("email-subject");
    if (emailSubjectDivRef.current) {
      updateDragCaret(e, emailSubjectDivRef.current);
    }
  };

  const handleEmailSubjectDragLeave = () => {
    setDragOverField(null);
    removeDragCaret();
  };

  const handleEmailSubjectDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOverField(null);
    removeDragCaret();
    const variable = e.dataTransfer.getData("text/plain");
    
    if (variable && variables.some(v => v.key === variable)) {
      let range: Range | null = null;
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(e.clientX, e.clientY);
      } else if (e.nativeEvent && (e.nativeEvent as any).rangeParent) {
        const ne = e.nativeEvent as any;
        range = document.createRange();
        range.setStart(ne.rangeParent, ne.rangeOffset);
      }

      if (range) {
        const name = emailModal.submission ? emailModal.submission.producer_name : "Productor";
        const trackName = emailModal.submission ? emailModal.submission.track_name : "Track";
        const bpmValue = emailModal.submission ? (emailModal.submission.bpm ? String(Math.round(emailModal.submission.bpm)) : "—") : "BPM";
        const labelVal = labelName || "Sello";

        let textToShow = "";
        if (variable === "{producer}") textToShow = name;
        else if (variable === "{track}") textToShow = trackName;
        else if (variable === "{bpm}") textToShow = bpmValue;
        else if (variable === "{label}") textToShow = labelVal;

        const span = document.createElement("span");
        span.setAttribute("contenteditable", "false");
        span.setAttribute("data-variable", variable);
        span.className = "inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium mx-0.5 border border-emerald-500/20 select-all";
        span.textContent = textToShow;

        range.insertNode(span);
        range.setStartAfter(span);
        range.setEndAfter(span);
        
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }

        const html = e.currentTarget.innerHTML;
        const text = convertHtmlToText(html);
        lastSyncedSubjectTextRef.current = text;
        setEmailSubject(text);
      }
    }
  };

  const VariableChips = () => (
    <div className="flex gap-1.5 flex-wrap mb-2">
      {variables.map((v) => (
        <span
          key={v.key}
          draggable
          onDragStart={(e) => handleDragStart(e, v.key)}
          onClick={() => {
            insertEmailVariable(v.key, lastActiveField);
          }}
          className="text-[10px] px-2 py-0.5 rounded border cursor-grab active:cursor-grabbing transition-colors hover:border-emerald-500 hover:bg-emerald-500/5 select-none"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)", background: "transparent" }}
          title={v.desc}
        >
          +{v.label}
        </span>
      ))}
      <span className="text-[9px] text-muted self-center ml-1">{t("crm.drag_hint")}</span>
    </div>
  );

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

  // Wire undo/redo for email composer (active when emailModal is open)
  useUndoRedoKey({
    onUndo: () => { undoEmailBody(); undoEmailSubject(); },
    onRedo: () => { redoEmailBody(); redoEmailSubject(); },
    enabled: emailModal.open,
  });

  // Sync contenteditable HTML when text or contact details change (body)
  useEffect(() => {
    const contactChanged = emailModal.submission !== lastSyncedContactRef.current;
    const labelChanged = labelName !== lastSyncedLabelRef.current;
    const textChanged = emailBody !== lastSyncedTextRef.current;

    if (textChanged || contactChanged || labelChanged) {
      const isFocused = typeof document !== "undefined" && document.activeElement === emailBodyDivRef.current;
      if (!isFocused || contactChanged || labelChanged) {
        if (emailBodyDivRef.current) {
          emailBodyDivRef.current.innerHTML = convertTextToHtml(emailBody, emailModal.submission || null, labelName);
        }
      }
      lastSyncedTextRef.current = emailBody;
      lastSyncedContactRef.current = emailModal.submission || null;
      lastSyncedLabelRef.current = labelName;
    }
  }, [emailBody, emailModal.submission, labelName]);

  // Sync contenteditable HTML when text or contact details change (subject)
  useEffect(() => {
    const contactChanged = emailModal.submission !== lastSyncedSubjectContactRef.current;
    const labelChanged = labelName !== lastSyncedSubjectLabelRef.current;
    const textChanged = emailSubject !== lastSyncedSubjectTextRef.current;

    if (textChanged || contactChanged || labelChanged) {
      const isFocused = typeof document !== "undefined" && document.activeElement === emailSubjectDivRef.current;
      if (!isFocused || contactChanged || labelChanged) {
        if (emailSubjectDivRef.current) {
          emailSubjectDivRef.current.innerHTML = convertTextToHtml(emailSubject, emailModal.submission || null, labelName);
        }
      }
      lastSyncedSubjectTextRef.current = emailSubject;
      lastSyncedSubjectContactRef.current = emailModal.submission || null;
      lastSyncedSubjectLabelRef.current = labelName;
    }
  }, [emailSubject, emailModal.submission, labelName]);

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
  const [isFrozen, setIsFrozen] = useState<boolean>(false);

  useEffect(() => {
    const fetchSignature = async () => {
      const slug = localStorage.getItem("slug");
      if (!slug) return;
      try {
        const res = await fetch(`/api/labels/${slug}`);
        if (res.ok) {
          const data = await res.json();
          setSonicSignature(data.sonic_signature);
          setLabelName(data.name || slug);
          setIsFrozen(data.subscription_status === "frozen");
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

  // Download loading state per submission
  const [downloadLoading, setDownloadLoading] = useState<Record<string, boolean>>({});

  // Scroll refs for infinite scroll
  const inboxScrollRef = useRef<HTMLDivElement>(null);
  const shortlistScrollRef = useRef<HTMLDivElement>(null);
  const rejectedScrollRef = useRef<HTMLDivElement>(null);
  const systemScrollRef = useRef<HTMLDivElement>(null);
  const trashScrollRef = useRef<HTMLDivElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);

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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        fetchColumn("inbox"),
        fetchColumn("shortlist"),
        fetchColumn("rejected"),
        fetchSystem(),
        fetchTrash()
      ]);
      addToast({
        title: lang === "es" ? "Inbox actualizado" : "Inbox refreshed",
        description: lang === "es" ? "Los tracks se cargaron correctamente." : "Tracks have been successfully loaded.",
      });
    } catch (e) {
      addToast({
        title: "Error",
        description: lang === "es" ? "No se pudieron actualizar los tracks." : "Failed to refresh tracks.",
        variant: "destructive"
      });
    } finally {
      setIsRefreshing(false);
    }
  };

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
      column: "inbox" | "shortlist" | "rejected" | "system" | "trash" | "list"
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
      } else if (column === "list") {
        if (boardHasMore.inbox && !boardLoading.inbox) fetchColumn("inbox", true);
        if (boardHasMore.shortlist && !boardLoading.shortlist) fetchColumn("shortlist", true);
        if (boardHasMore.rejected && !boardLoading.rejected) fetchColumn("rejected", true);
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
    if (isFrozen) {
      addToast({
        title: "Cuenta congelada",
        description: "Renueva tu plan para usar el inbox.",
        variant: "destructive",
      });
      return;
    }
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
        : destination.droppableId === "inbox"
        ? "inbox"
        : null;

    // If dropping to same column, no status change needed
    if (!targetStatus || destination.droppableId === sourceCol) return;

    // If rejecting, we need a reason — open rejection modal
    if (targetStatus === "rejected") {
      setPendingReject({ sub, reason: "" });
      return;
    }

    if (targetStatus === "inbox") {
      markAsInteracted(subId);
      await updateStatus(sub, "inbox");
      return;
    }

    // Shortlist: update status then open email modal
    markAsInteracted(subId);
    await updateStatus(sub, "shortlist");
  };

  const updateStatus = async (
    sub: SubmissionSummary,
    status: "inbox" | "shortlist" | "rejected",
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
        } else if (status === "inbox") {
          next.inbox = [updated, ...next.inbox];
        }
        return next;
      });
      // NOTE: email modal is now decoupled — user triggers it manually from the card
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

    const initSubject = firstMatch
      ? replaceVariables(cleanHtmlToPlainText(firstMatch.subject_template), sub, labelName)
      : "";
    const initBody = firstMatch
      ? replaceVariables(cleanHtmlToPlainText(firstMatch.body_template), sub, labelName)
      : "";

    setEmailSubject(initSubject);
    setEmailBody(initBody);

    setEmailModal({
      open: true,
      submission: sub,
      targetStatus,
      templates,
      selectedTemplate: firstMatch?.id || "",
      subject: initSubject,
      body: initBody,
      sending: false,
      sent: false,
      error: null,
    });
  };

  const handleTemplateChange = (templateId: string) => {
    const tmpl = emailModal.templates.find((t) => t.id === templateId);
    if (!tmpl || !emailModal.submission) return;
    const newSubject = replaceVariables(cleanHtmlToPlainText(tmpl.subject_template), emailModal.submission, labelName);
    const newBody = replaceVariables(cleanHtmlToPlainText(tmpl.body_template), emailModal.submission, labelName);
    setEmailSubject(newSubject);
    setEmailBody(newBody);
    setEmailModal((prev) => ({
      ...prev,
      selectedTemplate: templateId,
      subject: newSubject,
      body: newBody,
    }));
  };

  const handleSendEmail = async () => {
    if (!emailModal.submission) return;
    const subId = emailModal.submission.id;
    const subjectToSend = emailSubject;
    const bodyToSend = emailBody;
    setEmailModal((p) => ({ ...p, sending: true, error: null }));
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          to: emailModal.submission.producer_email || "",
          subject: subjectToSend,
          body: bodyToSend,
          from_name: labelName || "True Peak AI",
          submission_id: subId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Error ${res.status}`);
      }

      // Mark human_email_sent locally across all state stores
      const markSent = (s: SubmissionSummary) =>
        s.id === subId ? { ...s, human_email_sent: true } : s;

      setBoard((prev) => ({
        inbox: prev.inbox.map(markSent),
        shortlist: prev.shortlist.map(markSent),
        rejected: prev.rejected.map(markSent),
      }));
      setSystemItems((prev) => prev.map(markSent));
      setTrashItems((prev) => prev.map(markSent));
      setDetailModal((prev) =>
        prev.submission?.id === subId
          ? { ...prev, submission: { ...prev.submission, human_email_sent: true } }
          : prev
      );

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

  // ─── HQ Download ─────────────────────────────────────────────────────────

  const handleDownloadHQ = async (sub: SubmissionSummary) => {
    setDownloadLoading((p) => ({ ...p, [sub.id]: true }));
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`/api/submissions/${sub.id}/download`, {
        credentials: "include",
        headers,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Error ${res.status}`);
      }

      // Trigger browser download
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const contentDisposition = res.headers.get("content-disposition") || "";
      const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
      a.href = url;
      a.download = filenameMatch?.[1] || `${sub.track_name || sub.id}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Mark as downloaded in local state (original_path will be null server-side)
      const updateSub = (s: SubmissionSummary) =>
        s.id === sub.id ? { ...s, hq_downloaded: true, original_path: null } : s;

      setBoard((prev) => ({
        inbox: prev.inbox.map(updateSub),
        shortlist: prev.shortlist.map(updateSub),
        rejected: prev.rejected.map(updateSub),
      }));

      addToast({ title: "HQ descargado y eliminado del servidor", variant: "success" });
    } catch (e) {
      addToast({
        title: "Error al descargar",
        description: e instanceof Error ? e.message : "Error desconocido",
        variant: "destructive",
      });
    } finally {
      setDownloadLoading((p) => {
        const next = { ...p };
        delete next[sub.id];
        return next;
      });
    }
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
    if (isFrozen) {
      addToast({
        title: "Cuenta congelada",
        description: "Renueva tu plan para reproducir audios.",
        variant: "destructive",
      });
      return;
    }
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
                  {statusLabel(sub.status, role, t)}
                </span>
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
                sub.human_email_sent ? (
                  <div
                    className="w-6 h-6 rounded flex items-center justify-center"
                    style={{ color: "#10b981" }}
                    title="Email ya enviado al productor"
                  >
                    <Mail className="w-4 h-4" />
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      markAsInteracted(sub.id);
                      openEmailModal(sub, sub.status === "shortlist" ? "shortlist" : "rejected");
                    }}
                    className="w-6 h-6 rounded flex items-center justify-center transition-colors hover:bg-white/10"
                    style={{ color: "var(--text-muted)" }}
                    title="Enviar email al productor"
                  >
                    <Mail className="w-4 h-4" />
                  </button>
                )
              )}
              {/* HQ Download button */}
              {sub.hq_downloaded ? (
                <div
                  className="w-6 h-6 rounded flex items-center justify-center"
                  style={{ color: "#10b981" }}
                  title="HQ descargado"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
              ) : sub.original_path ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownloadHQ(sub);
                  }}
                  disabled={downloadLoading[sub.id]}
                  className="w-6 h-6 rounded flex items-center justify-center transition-colors hover:bg-white/10 disabled:opacity-50"
                  style={{ color: "#10b981" }}
                  title="Descargar HQ (se elimina del servidor al descargar)"
                >
                  {downloadLoading[sub.id] ? (
                    <div className="w-3 h-3 border border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  )}
                </button>
              ) : sub.status === "shortlist" ? (
                <div
                  className="w-6 h-6 rounded flex items-center justify-center"
                  style={{ color: "var(--text-muted)" }}
                  title="El archivo de alta calidad expiró. Contactá al productor para solicitar el HQ original"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                </div>
              ) : null}
              {sub.producer_instagram && (
                <a
                  href={`https://instagram.com/${sub.producer_instagram.replace(/^@/, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="w-6 h-6 rounded flex items-center justify-center transition-colors hover:bg-white/10"
                  style={{ color: "#10b981" }}
                  title={`Instagram: @${sub.producer_instagram.replace(/^@/, "")}`}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" /></svg>
                </a>
              )}
              {sub.producer_soundcloud && (
                <a
                  href={`https://soundcloud.com/${sub.producer_soundcloud}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="w-6 h-6 rounded flex items-center justify-center transition-colors hover:bg-white/10"
                  style={{ color: "#f97316" }}
                  title={`SoundCloud: ${sub.producer_soundcloud}`}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-.55 0-1 .45-1 1v7c0 .55.45 1 1 1s1-.45 1-1v-7c0-.55-.45-1-1-1zm3-2c-.55 0-1 .45-1 1v9c0 .55.45 1 1 1s1-.45 1-1V8c0-.55-.45-1-1-1zm3 2c-.55 0-1 .45-1 1v7c0 .55.45 1 1 1s1-.45 1-1v-7c0-.55-.45-1-1-1zm3 2c-.55 0-1 .45-1 1v5c0 .55.45 1 1 1s1-.45 1-1v-5c0-.55-.45-1-1-1zM9 11c-.55 0-1 .45-1 1v5c0 .55.45 1 1 1s1-.45 1-1v-5c0-.55-.45-1-1-1zm-3 2c-.55 0-1 .45-1 1v3c0 .55.45 1 1 1s1-.45 1-1v-3c0-.55-.45-1-1-1zm-3 1c-.55 0-1 .45-1 1v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1z" /></svg>
                </a>
              )}
              <div className="flex-1" />
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
    const items = filterSubmissions(board[colId], filters);
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
              {hasMore && !loading && (
                <div className="py-4 flex justify-center">
                  <button
                    onClick={() => fetchColumn(colId, true)}
                    className="px-4 py-1.5 text-xs border rounded hover:bg-white/5 transition-colors"
                  >
                    Cargar más
                  </button>
                </div>
              )}
            </div>
          )}
        </Droppable>
      </div>
    );
  };

  // ─── Status change for list view ──────────────────────────────────────────

  const handleStatusChange = async (sub: SubmissionSummary, newStatus: "inbox" | "shortlist" | "rejected") => {
    if (newStatus === "rejected") {
      setPendingReject({ sub, reason: "" });
    } else {
      await updateStatus(sub, newStatus);
    }
  };

  const handleLoadMoreList = async () => {
    const promises = [];
    if (boardHasMore.inbox && !boardLoading.inbox) promises.push(fetchColumn("inbox", true));
    if (boardHasMore.shortlist && !boardLoading.shortlist) promises.push(fetchColumn("shortlist", true));
    if (boardHasMore.rejected && !boardLoading.rejected) promises.push(fetchColumn("rejected", true));
    await Promise.all(promises);
  };

  // ─── Render: List Tab (Compact Table View) ────────────────────────────────

  const renderListTab = () => {
    const allItems = [...board.inbox, ...board.shortlist, ...board.rejected];
    const uniqueItems = Array.from(new Map(allItems.map(item => [item.id, item])).values());
    uniqueItems.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const filteredItems = filterSubmissions(uniqueItems, filters);

    return (
      <div
        ref={listScrollRef}
        className="rounded border overflow-hidden"
        style={{
          background: "var(--bg-secondary)",
          borderColor: "var(--border)",
          maxHeight: "calc(100vh - 250px)",
          overflowY: "auto",
        }}
        onScroll={(e) => handleScroll(e, "list")}
      >
        {/* Header */}
        <div
          className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-muted border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="col-span-3 flex items-center gap-2">
            <span>{t("inbox.header.track")}</span>
          </div>
          <div className="col-span-1 text-center">{t("inbox.header.bpm")}</div>
          <div className="col-span-1 text-center">{t("inbox.header.lufs")}</div>
          <div className="col-span-1 text-center">{t("inbox.header.phase")}</div>
          <div className="col-span-1 text-center">Clave</div>
          <div className="col-span-2 text-center">Estado</div>
          <div className="col-span-3 text-right">Acciones</div>
        </div>

        {filteredItems.length > 0 ? (
          filteredItems.map((d) => {
            const isPlayingThis = isPlaying && currentTrack?.id === d.id;
            const isLoading = actionLoading[d.id];
            
            return (
              <div
                key={d.id}
                className="grid grid-cols-12 gap-2 px-4 py-3 text-xs items-center border-b cursor-pointer hover:bg-white/[0.02] transition-colors"
                style={{ borderColor: "var(--border-light)" }}
                onClick={() => setDetailModal({ open: true, submission: d })}
              >
                {/* Track Details & Play Button */}
                <div className="col-span-3 flex items-center gap-2 min-w-0">
                  {d.mp3_path && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleListen(d);
                      }}
                      disabled={!!isLoading}
                      className="w-8 h-8 rounded-full flex items-center justify-center transition-all bg-white/5 hover:bg-white/10 text-white flex-shrink-0 disabled:opacity-50"
                      style={{
                        color: isPlayingThis ? "#10b981" : "inherit",
                        border: isPlayingThis ? "1px solid #10b981" : "1px solid var(--border)",
                      }}
                      title={isPlayingThis ? "Pausar" : "Reproducir"}
                    >
                      {isPlayingThis ? (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="4" width="4" height="16" />
                          <rect x="14" y="4" width="4" height="16" />
                        </svg>
                      ) : (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      )}
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate hover:text-emerald-500 transition-colors">
                      {d.track_name || t("inbox.modal.no_name")}
                    </div>
                    <div className="text-[10px] text-muted truncate">
                      {d.producer_name || t("inbox.modal.anonymous")} · {formatRelativeTime(d.created_at)}
                    </div>
                  </div>
                </div>

                {/* Technical Columns */}
                <div className="col-span-1 text-center font-mono">
                  {formatBpm(d.bpm)}
                </div>
                <div className="col-span-1 text-center font-mono">
                  {formatLufs(d.lufs)}
                </div>
                <div className="col-span-1 text-center font-mono text-muted">
                  {d.phase_correlation != null ? d.phase_correlation.toFixed(2) : "—"}
                </div>
                <div className="col-span-1 text-center font-mono text-muted">
                  {formatKey(d.musical_key)}
                </div>

                {/* Status Badge (static) */}
                <div className="col-span-2 text-center">
                  <span
                    className="font-mono text-[10px] px-2 py-0.5 rounded"
                    style={{ background: statusBadgeColor(d.status).bg, color: statusBadgeColor(d.status).color }}
                  >
                    {statusLabel(d.status, role, t)}
                  </span>
                </div>

                {/* Action Buttons */}
                <div
                  className="col-span-3 text-right flex items-center justify-end gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Approve (checkmark) — disabled if already shortlist */}
                  <button
                    onClick={() => updateStatus(d, "shortlist")}
                    disabled={!!isLoading || d.status === "shortlist"}
                    className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-emerald-500/10"
                    style={{
                      color: "#10b981",
                      border: "1px solid rgba(16,185,129,0.2)",
                      opacity: d.status === "shortlist" ? 0.3 : 1,
                      pointerEvents: d.status === "shortlist" ? "none" : "auto",
                    }}
                    title={t("inbox.kanban.approve")}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>

                  {/* Reject (cross) — disabled if already rejected */}
                  <button
                    onClick={() => setPendingReject({ sub: d, reason: "" })}
                    disabled={!!isLoading || d.status === "rejected"}
                    className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-red-500/10"
                    style={{
                      color: "#ef4444",
                      border: "1px solid rgba(239,68,68,0.2)",
                      opacity: d.status === "rejected" ? 0.3 : 1,
                      pointerEvents: d.status === "rejected" ? "none" : "auto",
                    }}
                    title={t("inbox.kanban.reject")}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>

                  {/* Reset to inbox (RotateCcw) — disabled if already inbox */}
                  <button
                    onClick={() => updateStatus(d, "inbox")}
                    disabled={!!isLoading || d.status === "inbox"}
                    className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-white/5"
                    style={{
                      color: "var(--text-muted)",
                      border: "1px solid var(--border)",
                      opacity: d.status === "inbox" ? 0.3 : 1,
                      pointerEvents: d.status === "inbox" ? "none" : "auto",
                    }}
                    title="Mover a Inbox"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 .49-3.27" />
                    </svg>
                  </button>

                  {/* Email: icon only — green if sent, clickable if not */}
                  {d.producer_email && (
                    d.human_email_sent ? (
                      <div
                        className="w-7 h-7 rounded flex items-center justify-center"
                        style={{ color: "#10b981" }}
                        title="Email ya enviado al productor"
                      >
                        <Mail className="w-3.5 h-3.5" />
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          markAsInteracted(d.id);
                          openEmailModal(d, d.status === "shortlist" ? "shortlist" : "rejected");
                        }}
                        disabled={!!isLoading}
                        className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-white/5 disabled:opacity-50 border"
                        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                        title="Enviar email al productor"
                      >
                        <Mail className="w-3.5 h-3.5" />
                      </button>
                    )
                  )}

                  {/* Download HQ button */}
                  {d.original_path && (
                    <button
                      onClick={() => handleDownloadHQ(d)}
                      disabled={downloadLoading[d.id] || !!isLoading}
                      className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-white/5 disabled:opacity-50 border"
                      style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                      title="Descargar Original (HQ)"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </button>
                  )}

                  {/* Delete button */}
                  <TwoClickDelete
                    onDelete={() => handleDelete(d)}
                    size={20}
                  />
                </div>
              </div>
            );
          })
        ) : (
          <div className="py-12 text-center text-muted">
            No hay demos en esta vista.
          </div>
        )}

        {/* Load more indicator */}
        {(boardLoading.inbox || boardLoading.shortlist || boardLoading.rejected) && (
          <div className="py-3 text-center text-muted text-[10px]">
            {t("inbox.kanban.loading_more")}
          </div>
        )}

        {/* Load more button */}
        {(boardHasMore.inbox || boardHasMore.shortlist || boardHasMore.rejected) &&
          !(boardLoading.inbox || boardLoading.shortlist || boardLoading.rejected) && (
            <div className="py-4 flex justify-center">
              <button
                onClick={handleLoadMoreList}
                className="px-4 py-1.5 text-xs border rounded hover:bg-white/5 transition-colors"
                style={{ borderColor: "var(--border)" }}
              >
                Cargar más
              </button>
            </div>
          )}
      </div>
    );
  };

  // ─── Render: System Filtered Tab ──────────────────────────────────────────

  const renderSystemTab = () => {
    const filteredSystemItems = filterSubmissions(systemItems, filters);
    
    return (
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

      {filteredSystemItems.length > 0 ? (
        filteredSystemItems.map((d) => {
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

      {systemLoading && filteredSystemItems.length > 0 && (
        <div className="py-3 text-center text-muted text-[10px]">
          {t("inbox.kanban.loading_more")}
        </div>
      )}

      {systemHasMore && !systemLoading && (
        <div className="py-4 flex justify-center">
          <button
            onClick={() => fetchSystem(true)}
            className="px-4 py-1.5 text-xs border rounded hover:bg-white/5 transition-colors"
          >
            Cargar más
          </button>
        </div>
      )}
    </div>
  );
};

  // ─── Render: Trash Tab ────────────────────────────────────────────────────

  const renderTrashTab = () => {
    const filteredTrashItems = filterSubmissions(trashItems, filters);

    return (
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

      {filteredTrashItems.length > 0 ? (
        filteredTrashItems.map((d) => {
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
                  {statusLabel(d.status, role, t)}
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

      {trashLoading && filteredTrashItems.length > 0 && (
        <div className="py-3 text-center text-muted text-[10px]">
          {t("inbox.kanban.loading_more")}
        </div>
      )}

      {trashHasMore && !trashLoading && (
        <div className="py-4 flex justify-center">
          <button
            onClick={() => fetchTrash(true)}
            className="px-4 py-1.5 text-xs border rounded hover:bg-white/5 transition-colors"
          >
            Cargar más
          </button>
        </div>
      )}
    </div>
  );
};

  // ─── Main Render ──────────────────────────────────────────────────────────

  const tabs: { key: TabKey; label: string }[] = [
    { key: "kanban", label: t("inbox.kanban_tab") },
    { key: "system", label: role === "dj" ? t("inbox.kanban_dj.auto_rejected_col") : t("inbox.kanban.auto_rejected_col") },
    { key: "trash", label: t("inbox.kanban.trash_tab") },
  ];

  return (
    <div className="w-full max-w-[1700px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <h1 className="font-display font-semibold text-xl">
            {role === "dj" ? t("inbox.title_promos") : t("inbox.title_demos")}
          </h1>
        </div>

        {activeTab === "kanban" && (
          <div className="flex items-center gap-2">
            {/* View Toggle */}
            <div className="flex items-center rounded p-0.5 border" style={{ borderColor: "var(--border)", background: "var(--bg-card-alt)" }}>
              <button
                onClick={() => setViewMode("kanban")}
                className="px-3 py-1 text-xs font-medium rounded transition-all"
                style={{
                  background: viewMode === "kanban" ? "var(--bg-secondary)" : "transparent",
                  color: viewMode === "kanban" ? "var(--text-primary)" : "var(--text-muted)",
                  boxShadow: viewMode === "kanban" ? "0 1px 2px rgba(0,0,0,0.2)" : "none",
                }}
              >
                {t("inbox.view.kanban")}
              </button>
              <button
                onClick={() => setViewMode("list")}
                className="px-3 py-1 text-xs font-medium rounded transition-all"
                style={{
                  background: viewMode === "list" ? "var(--bg-secondary)" : "transparent",
                  color: viewMode === "list" ? "var(--text-primary)" : "var(--text-muted)",
                  boxShadow: viewMode === "list" ? "0 1px 2px rgba(0,0,0,0.2)" : "none",
                }}
              >
                {t("inbox.view.list")}
              </button>
            </div>

            {/* Refresh Button */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded border flex items-center justify-center hover:bg-white/5 disabled:opacity-50 transition-colors cursor-pointer"
              style={{ borderColor: "var(--border)", background: "var(--bg-card-alt)" }}
              title={lang === "es" ? "Actualizar" : "Refresh"}
            >
              <RotateCcw className={cn("w-4 h-4 text-muted hover:text-white transition-colors", isRefreshing && "animate-spin")} />
            </button>
          </div>
        )}
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

      {/* Tabs & Filters Row */}
      <div className="mb-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        {/* Left Side: Tabs */}
        <div className="flex gap-1 items-center flex-wrap">
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
              </span>
            </button>
          ))}

        </div>

        {/* Right Side: Filters */}
        <KanbanFilterBar sonicSignature={sonicSignature} />
      </div>

      {activeTab === "kanban" && (
        viewMode === "kanban" ? (
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
        ) : (
          renderListTab()
        )
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
                          {statusLabel(sub.status, role, t).toUpperCase()}
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
                      <div className="space-y-3">
                        <p className="text-sm">
                          <span className="text-muted block text-[10px] uppercase mb-0.5">Email del productor</span>
                          {sub.producer_email || t("crm.no_email")}
                        </p>
                        {sub.producer_instagram && (
                          <p className="text-sm">
                            <span className="text-muted block text-[10px] uppercase mb-0.5">Instagram</span>
                            <a 
                              href={`https://instagram.com/${sub.producer_instagram.replace(/^@/, "")}`} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="inline-flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" /></svg>
                              @{sub.producer_instagram.replace(/^@/, "")}
                            </a>
                          </p>
                        )}
                        {sub.producer_soundcloud && (
                          <p className="text-sm">
                            <span className="text-muted block text-[10px] uppercase mb-0.5">SoundCloud</span>
                            <a 
                              href={`https://soundcloud.com/${sub.producer_soundcloud}`} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="inline-flex items-center gap-1.5 text-orange-400 hover:text-orange-300 transition-colors font-medium"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-.55 0-1 .45-1 1v7c0 .55.45 1 1 1s1-.45 1-1v-7c0-.55-.45-1-1-1zm3-2c-.55 0-1 .45-1 1v9c0 .55.45 1 1 1s1-.45 1-1V8c0-.55-.45-1-1-1zm3 2c-.55 0-1 .45-1 1v7c0 .55.45 1 1 1s1-.45 1-1v-7c0-.55-.45-1-1-1zm3 2c-.55 0-1 .45-1 1v5c0 .55.45 1 1 1s1-.45 1-1v-5c0-.55-.45-1-1-1zM9 11c-.55 0-1 .45-1 1v5c0 .55.45 1 1 1s1-.45 1-1v-5c0-.55-.45-1-1-1zm-3 2c-.55 0-1 .45-1 1v3c0 .55.45 1 1 1s1-.45 1-1v-3c0-.55-.45-1-1-1zm-3 1c-.55 0-1 .45-1 1v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1z" /></svg>
                              {sub.producer_soundcloud}
                            </a>
                          </p>
                        )}
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
                  detailModal.submission.human_email_sent ? (
                    <div
                      className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border cursor-not-allowed"
                      style={{ borderColor: "rgba(16,185,129,0.4)", color: "#10b981", background: "rgba(16,185,129,0.07)" }}
                      title="Email ya enviado al productor"
                    >
                      <Mail className="w-4 h-4" />
                      ENVIADO!
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        const sub = detailModal.submission!;
                        setDetailModal({ open: false, submission: null });
                        openEmailModal(sub, sub.status === "shortlist" ? "shortlist" : "rejected");
                      }}
                      className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-colors hover:bg-white/5"
                      style={{ borderColor: "rgba(255,255,255,0.1)", color: "var(--text-secondary)" }}
                    >
                      <Mail className="w-4 h-4" />
                      ENVIAR MAIL
                    </button>
                  )
                )}
                {detailModal.submission.hq_downloaded ? (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border" style={{ borderColor: "rgba(16,185,129,0.3)", color: "#10b981" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    HQ DESCARGADO
                  </div>
                ) : detailModal.submission.original_path ? (
                  <button
                    onClick={() => { handleDownloadHQ(detailModal.submission!); setDetailModal({ open: false, submission: null }); }}
                    disabled={downloadLoading[detailModal.submission.id]}
                    className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all hover:scale-105 disabled:opacity-50"
                    style={{ borderColor: "#10b981", color: "#10b981", background: "rgba(16,185,129,0.08)" }}
                    title="El archivo original se eliminará del servidor tras la descarga"
                  >
                    {downloadLoading[detailModal.submission.id] ? (
                      <div className="w-4 h-4 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    )}
                    DESCARGAR HQ
                  </button>
                ) : detailModal.submission.status === "shortlist" ? (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-full text-sm border" style={{ borderColor: "rgba(255,255,255,0.08)", color: "var(--text-muted)" }}
                    title="El archivo de alta calidad expiró. Contactá al productor para solicitar el HQ original">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    HQ EXPIRADO
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-3">
                {detailModal.submission.status === "inbox" && (
                  <>
                    <button
                      onClick={() => { setPendingReject({ sub: detailModal.submission!, reason: "" }); setDetailModal({ open: false, submission: null }); }}
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

                  {/* Variable Chips */}
                  <VariableChips />

                  {/* Subject */}
                  <div>
                    <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">
                      {t("inbox.kanban.email_subject")}
                    </label>
                    <div
                      ref={emailSubjectDivRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={handleEmailSubjectInput}
                      onKeyDown={handleEmailSubjectKeyDown}
                      onFocus={() => setLastActiveField("subject")}
                      onDragOver={handleEmailSubjectDragOver}
                      onDragLeave={handleEmailSubjectDragLeave}
                      onDrop={handleEmailSubjectDrop}
                      className="w-full rounded px-3 py-2 text-sm border min-h-[36px] outline-none transition-colors"
                      style={{
                        background: "var(--bg-card)",
                        borderColor: dragOverField === "email-subject" ? "#10b981" : "var(--border)",
                        color: "var(--text-primary)",
                        lineHeight: "1.5",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    />
                  </div>

                  {/* Body */}
                  <div>
                    <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">
                      {t("inbox.kanban.email_body")}
                    </label>
                    <div
                      ref={emailBodyDivRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={handleEmailBodyInput}
                      onFocus={() => setLastActiveField("body")}
                      onDragOver={handleEmailBodyDragOver}
                      onDragLeave={handleEmailBodyDragLeave}
                      onDrop={handleEmailBodyDrop}
                      className="w-full rounded px-3 py-2 text-sm border min-h-[150px] outline-none transition-colors"
                      style={{
                        background: "var(--bg-card)",
                        borderColor: dragOverField === "email-body" ? "#10b981" : "var(--border)",
                        color: "var(--text-primary)",
                        lineHeight: "1.6",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        overflowY: "auto",
                        maxHeight: "260px",
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
