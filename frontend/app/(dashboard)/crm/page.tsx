"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { cn } from "@/lib/utils";
import { usePlayer } from "@/lib/PlayerContext";
import { useLanguage } from "@/lib/i18n";
import { useUndoableState, useUndoRedoKey } from "@/lib/useUndoableState";
import { getCache, setCache } from "@/lib/cache";

interface Submission {
  id: string;
  producer_name: string;
  producer_email: string | null;
  track_name: string;
  status: "pending" | "approved" | "rejected";
  bpm: number | null;
  lufs: number | null;
  phase_correlation: number | null;
  musical_key: string | null;
  mp3_path: string | null;
  created_at: string;
  producer_instagram?: string | null;
  producer_soundcloud?: string | null;
  human_email_sent?: boolean;
}

interface Contact {
  id: string;
  name: string;
  email: string;
  track: string;
  status: "approved" | "rejected";
  bpm: string;
  sent: boolean;
  mp3_path: string | null;
  producer_instagram?: string | null;
  producer_soundcloud?: string | null;
}

interface Template {
  id: string;
  label: string;
  subject: string;
  body: string;
}

function buildTemplates(labelName: string, t: (key: any) => string): Template[] {
  return [
    {
      id: "reject-phase",
      label: t("crm.template.reject_phase"),
      subject: `Tu demo en ${labelName} — Feedback técnico`,
      body: `Hola {producer},\n\nGracias por enviar "{track}" a ${labelName}. Lo escuchamos y analizamos con nuestro motor técnico.\n\nLamentablemente, detectamos un problema de fase invertida en los canales L/R que afecta la compatibilidad mono del track. Esto es crítico para nosotros ya que nuestro material se reproduce en sistemas de club.\n\nTe sugerimos revisar la correlación de fase en tu master y volver a enviar.\n\nSaludos,\nEquipo A&R — ${labelName}`,
    },
    {
      id: "reject-tempo",
      label: t("crm.template.reject_tempo"),
      subject: `Tu demo en ${labelName} — Feedback técnico`,
      body: `Hola {producer},\n\nGracias por enviar "{track}" a ${labelName}.\n\nTu track está en {bpm} BPM, mientras que nuestro rango aceptado es 120–128 BPM. Por eso no podemos considerarlo para nuestro catálogo actual.\n\nSi tenés material en el rango correcto, no dudes en enviarlo.\n\nSaludos,\nEquipo A&R — ${labelName}`,
    },
    {
      id: "approve",
      label: t("crm.template.approve"),
      subject: `Tu demo fue aprobado en ${labelName}`,
      body: `Hola {producer},\n\nBuenas noticias: "{track}" pasó nuestro filtro técnico y nos encantó.\n\nQueremos avanzar a la siguiente fase de revisión artística. Nuestro equipo de A&R va a contactarte en los próximos días.\n\nSaludos,\nEquipo A&R — ${labelName}`,
    },
    {
      id: "followup",
      label: t("crm.template.followup"),
      subject: `Re: Tu demo corregido en ${labelName}`,
      body: `Hola {producer},\n\nRecibimos la versión corregida de "{track}". Estamos revisándola.\n\nTe avisamos en 48hs si pasa a la fase de escucha artística.\n\nGracias por la paciencia,\nEquipo A&R — ${labelName}`,
    },
  ];
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

const convertTextToHtml = (text: string, c: Contact | null, labelName: string) => {
  if (!text) return "";
  
  let html = escapeHtml(text);

  const name = c ? c.name : "Productor";
  const trackName = c ? c.track : "Track";
  const bpmValue = c ? c.bpm : "BPM";
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
  return text.replace(/\u200B/g, "").replace(/\r\n/g, "\n");
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

const resolvePlaceholders = (text: string, c: Contact, labelName: string) => {
  if (!text) return "";
  return text
    .replace(/{producer}/g, c.name || "")
    .replace(/{track}/g, c.track || "")
    .replace(/{bpm}/g, c.bpm || "")
    .replace(/{label}/g, labelName || "");
};

function CRMContent() {
  const { t } = useLanguage();
  const [selectedTemplate, setSelectedTemplate] = useState("reject-phase");
  const [selectedContact, setSelectedContact] = useState(0);
  const emailBodyState = useUndoableState("");
  const emailSubjectState = useUndoableState("");
  const { value: emailBody, set: setEmailBody, undo: undoEmailBody, redo: redoEmailBody } = emailBodyState;
  const { value: emailSubject, set: setEmailSubject, undo: undoEmailSubject, redo: redoEmailSubject } = emailSubjectState;
  const [sent, setSent] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [labelName, setLabelName] = useState<string>("");
  const [labelSlug, setLabelSlug] = useState<string>("");
  const [ownerEmail, setOwnerEmail] = useState<string>("");
  const [replyToEmail, setReplyToEmail] = useState<string>("");
  const [replyToInput, setReplyToInput] = useState<string>("");
  const [replyToEditing, setReplyToEditing] = useState(false);
  const [replyToSaving, setReplyToSaving] = useState(false);
  const [replyToSaved, setReplyToSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const { playTrack, togglePlay, isPlaying, currentTrack } = usePlayer();
  const searchParams = useSearchParams();
  const highlightParam = searchParams.get("highlight");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  useEffect(() => {
    if (highlightParam) {
      setHighlightedId(highlightParam);
    }
  }, [highlightParam]);

  const emailBodyDivRef = useRef<HTMLDivElement | null>(null);
  const lastSyncedTextRef = useRef("");
  const lastSyncedContactRef = useRef<Contact | null>(null);
  const lastSyncedLabelRef = useRef("");

  const emailSubjectDivRef = useRef<HTMLDivElement | null>(null);
  const lastSyncedSubjectTextRef = useRef("");
  const lastSyncedSubjectContactRef = useRef<Contact | null>(null);
  const lastSyncedSubjectLabelRef = useRef("");

  const [lastActiveField, setLastActiveField] = useState<"body" | "subject">("body");

  useEffect(() => {
    const fetchData = async () => {
      const slug = localStorage.getItem("slug");
      if (slug) {
        setLabelSlug(slug);
        // Load cached label name from our main label cache key first
        const cachedLabel = getCache<any>("tp_link_label_info", null);
        if (cachedLabel?.name) {
          setLabelName(cachedLabel.name);
        }
        // Always fetch fresh label config to get reply_to_email
        try {
          const res = await fetch(`/api/labels/${slug}`, { credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            setLabelName(data.name);
            setOwnerEmail(data.owner_email || "");
            const rt = data.reply_to_email || "";
            setReplyToEmail(rt);
            setReplyToInput(rt);
          }
        } catch { if (!cachedLabel?.name) setLabelName(slug); }
      }

      // Load cached contacts to enable instant page interactivity
      const cachedContacts = getCache<Contact[]>("tp_crm_contacts", []);
      if (cachedContacts.length > 0) {
        setContacts(cachedContacts);
        setLoading(false);
      }

      try {
        const res = await fetch(`/api/submissions`, { credentials: "include" });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data: Submission[] = await res.json();
        const resolved = data.filter((s) => s.status !== "pending");
        const mapped: Contact[] = resolved.map((s) => ({
          id: s.id, name: s.producer_name || "Anónimo", email: s.producer_email || "",
          track: s.track_name || "Sin nombre", status: s.status as "approved" | "rejected",
          bpm: s.bpm != null ? String(Math.round(s.bpm)) : "—", sent: s.human_email_sent ?? false, mp3_path: s.mp3_path || null,
          producer_instagram: s.producer_instagram || null,
          producer_soundcloud: s.producer_soundcloud || null,
        }));
        setContacts(mapped);
        setCache("tp_crm_contacts", mapped);
      } catch (e) { 
        if (cachedContacts.length === 0) {
          setError(e instanceof Error ? e.message : t("inbox.error_unknown")); 
        }
      } finally { 
        setLoading(false); 
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (highlightedId && contacts.length > 0) {
      const idx = contacts.findIndex((c) => c.id === highlightedId);
      if (idx >= 0) {
        setSelectedContact(idx);
        setTimeout(() => {
          const el = document.getElementById(`crm-contact-${highlightedId}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          
          // Clear highlight indicators after the breathe animation completes
          setTimeout(() => {
            setHighlightedId(null);
            if (window.location.search.includes("highlight")) {
              window.history.replaceState(null, "", "/crm");
            }
          }, 1500);
        }, 200);
      }
    }
  }, [highlightedId, contacts]);

  const templates = buildTemplates(labelName || "tu sello", t);
  const contact = contacts[selectedContact];
  const isAlreadySent = sent || (contact?.sent ?? false);
  const template = templates.find((t) => t.id === selectedTemplate);

  const resolveTemplate = (tpl: Template, c: Contact) => {
    return tpl.body;
  };

  const handleTemplateChange = (id: string) => {
    setSelectedTemplate(id);
    const tpl = templates.find((t) => t.id === id)!;
    setEmailSubject(tpl.subject);
    setEmailBody(tpl.body); // Keep placeholders!
    setSent(false);
  };

  const handleContactChange = (idx: number) => {
    setSelectedContact(idx);
    setSent(false);
    setHighlightedId(null);
    if (window.location.search.includes("highlight")) {
      window.history.replaceState(null, "", "/crm");
    }
  };

  useEffect(() => {
    if (!contact) return;

    if (contact.sent) {
      // Clear inputs first so we don't show stale content while fetching
      setEmailSubject("");
      setEmailBody("");
      
      const fetchSentEmail = async () => {
        try {
          const res = await fetch(`/api/email/logs/${contact.id}`, { credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            setEmailSubject(data.subject || "");
            setEmailBody(data.body || "");
          } else {
            // Fallback: use current template values or defaults
            if (template) {
              setEmailSubject(template.subject);
              setEmailBody(template.body);
            } else {
              setEmailSubject("");
              setEmailBody("");
            }
          }
        } catch (e) {
          console.error("Error fetching sent email log", e);
          // Fallback: use current template values or defaults
          if (template) {
            setEmailSubject(template.subject);
            setEmailBody(template.body);
          } else {
            setEmailSubject("");
            setEmailBody("");
          }
        }
      };
      fetchSentEmail();
    } else {
      if (template) {
        setEmailSubject(template.subject);
        setEmailBody(template.body);
      } else {
        setEmailSubject("");
        setEmailBody("");
      }
    }
  }, [contact?.id, contact?.sent, selectedTemplate, labelName]);

  // Sync contenteditable HTML when text or contact details change (body)
  useEffect(() => {
    const contactChanged = contact !== lastSyncedContactRef.current;
    const labelChanged = labelName !== lastSyncedLabelRef.current;
    const textChanged = emailBody !== lastSyncedTextRef.current;

    if (textChanged || contactChanged || labelChanged) {
      const isFocused = typeof document !== "undefined" && document.activeElement === emailBodyDivRef.current;
      
      if (!isFocused || contactChanged || labelChanged) {
        if (emailBodyDivRef.current) {
          emailBodyDivRef.current.innerHTML = convertTextToHtml(emailBody, contact || null, labelName);
        }
      }
      
      lastSyncedTextRef.current = emailBody;
      lastSyncedContactRef.current = contact || null;
      lastSyncedLabelRef.current = labelName;
    }
  }, [emailBody, contact, labelName]);

  // Sync contenteditable HTML when text or contact details change (subject)
  useEffect(() => {
    const contactChanged = contact !== lastSyncedSubjectContactRef.current;
    const labelChanged = labelName !== lastSyncedSubjectLabelRef.current;
    const textChanged = emailSubject !== lastSyncedSubjectTextRef.current;

    if (textChanged || contactChanged || labelChanged) {
      const isFocused = typeof document !== "undefined" && document.activeElement === emailSubjectDivRef.current;
      
      if (!isFocused || contactChanged || labelChanged) {
        if (emailSubjectDivRef.current) {
          emailSubjectDivRef.current.innerHTML = convertTextToHtml(emailSubject, contact || null, labelName);
        }
      }
      
      lastSyncedSubjectTextRef.current = emailSubject;
      lastSyncedSubjectContactRef.current = contact || null;
      lastSyncedSubjectLabelRef.current = labelName;
    }
  }, [emailSubject, contact, labelName]);

  const rejectionCount = contacts.filter((c) => c.status === "rejected").length;
  const approvalCount = contacts.filter((c) => c.status === "approved").length;
  const plan = typeof window !== "undefined" ? localStorage.getItem("plan") : "free";
  const isFree = plan === "free" || !plan;

  const [activeTab, setActiveTab] = useState<"bandeja" | "templates">("bandeja");
  const [dbTemplates, setDbTemplates] = useState<any[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateType, setTemplateType] = useState("rejection");
  const templateSubjectState = useUndoableState("");
  const templateBodyState = useUndoableState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [bodyCursor, setBodyCursor] = useState(0);
  const [subjectCursor, setSubjectCursor] = useState(0);
  const [bodyRef, setBodyRef] = useState<HTMLTextAreaElement | null>(null);
  const [subjectRef, setSubjectRef] = useState<HTMLInputElement | null>(null);
  const [dragOverField, setDragOverField] = useState<"email-body" | "email-subject" | "template-body" | "template-subject" | null>(null);
  const [dragCursorPos, setDragCursorPos] = useState(0);

  // Wire undo/redo for email composer (active when on bandeja tab)
  useUndoRedoKey({
    onUndo: () => { undoEmailBody(); undoEmailSubject(); },
    onRedo: () => { redoEmailBody(); redoEmailSubject(); },
    enabled: activeTab === "bandeja",
  });

  // Wire undo/redo for template form (active when on templates tab)
  useUndoRedoKey({
    onUndo: () => { templateBodyState.undo(); templateSubjectState.undo(); },
    onRedo: () => { templateBodyState.redo(); templateSubjectState.redo(); },
    enabled: activeTab === "templates",
  });

  const handleSendEmail = async () => {
    if (!contact) return;
    if (!contact.email) { setSendError(t("crm.send_error_no_email")); return; }
    setSending(true); setSendError(null);
    try {
      const resolvedSubject = resolvePlaceholders(emailSubject, contact, labelName);
      const resolvedBody = resolvePlaceholders(emailBody, contact, labelName);
      const res = await fetch(`/api/email/send`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: contact.email, subject: resolvedSubject, body: resolvedBody, from_name: labelName, submission_id: contact.id }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.detail || `Error ${res.status}`); }
      setSent(true);
      setContacts((prev) => {
        const next = prev.map((c, i) => (i === selectedContact ? { ...c, sent: true } : c));
        setCache("tp_crm_contacts", next);
        return next;
      });
    } catch (e) { setSendError(e instanceof Error ? e.message : t("crm.send_error")); }
    finally { setSending(false); }
  };

  const handleSaveReplyTo = async () => {
    if (!labelSlug) return;
    setReplyToSaving(true);
    try {
      const payload = { reply_to_email: replyToInput.trim() || null };
      const res = await fetch(`/api/labels/${labelSlug}/email-config`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setReplyToEmail(data.reply_to_email || "");
      setReplyToInput(data.reply_to_email || "");
      setReplyToEditing(false);
      setReplyToSaved(true);
      setTimeout(() => setReplyToSaved(false), 2500);
    } catch { /* ignore, user can retry */ }
    finally { setReplyToSaving(false); }
  };

  /** Get character offset in a textarea/input from mouse event coordinates */
  const getCaretOffsetFromPoint = useCallback((el: HTMLInputElement | HTMLTextAreaElement, x: number, y: number): number => {
    // Standard API
    if (typeof document.caretPositionFromPoint === "function") {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos && pos.offsetNode === el) return pos.offset;
      // If the offset node is a text node inside the element, calculate offset
      if (pos && pos.offsetNode?.nodeType === Node.TEXT_NODE && el.contains(pos.offsetNode)) {
        const textNode = pos.offsetNode as Text;
        // For textarea/input, the text node is the element itself
        return pos.offset;
      }
    }
    // WebKit fallback
    if (typeof document.caretRangeFromPoint === "function") {
      const range = document.caretRangeFromPoint(x, y);
      if (range && range.startContainer === el) return range.startOffset;
    }
    // Fallback: estimate based on character width (monospace approximation)
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize);
    const charWidth = fontSize * 0.6; // approximate
    const relX = x - rect.left - parseFloat(style.paddingLeft || "0");
    return Math.max(0, Math.min(el.value.length, Math.round(relX / charWidth)));
  }, []);

  /** Real-time drag cursor tracking — moves the native caret to show drop position */
  const handleDragOverField = useCallback((e: React.DragEvent, field: "email-body" | "email-subject" | "template-body" | "template-subject") => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOverField(field);

    const el = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
    const offset = getCaretOffsetFromPoint(el, e.clientX, e.clientY);
    setDragCursorPos(offset);

    // Move the native browser caret to show where the variable will be inserted
    if (el.tagName === "TEXTAREA") {
      (el as HTMLTextAreaElement).setSelectionRange(offset, offset);
    } else {
      (el as HTMLInputElement).setSelectionRange(offset, offset);
    }
  }, [getCaretOffsetFromPoint]);

  const handleDragLeave = useCallback(() => {
    setDragOverField(null);
  }, []);

  const insertVariable = (variable: string, field: "body" | "subject") => {
    if (field === "body" && bodyRef) {
      const pos = dragOverField === "template-body" ? dragCursorPos : bodyCursor;
      const before = templateBodyState.value.slice(0, pos);
      const after = templateBodyState.value.slice(pos);
      templateBodyState.set(before + variable + after);
      const newPos = pos + variable.length;
      setTimeout(() => { bodyRef.focus(); bodyRef.setSelectionRange(newPos, newPos); }, 0);
    } else if (field === "subject" && subjectRef) {
      const pos = dragOverField === "template-subject" ? dragCursorPos : subjectCursor;
      const before = templateSubjectState.value.slice(0, pos);
      const after = templateSubjectState.value.slice(pos);
      templateSubjectState.set(before + variable + after);
      const newPos = pos + variable.length;
      setTimeout(() => { subjectRef.focus(); subjectRef.setSelectionRange(newPos, newPos); }, 0);
    }
    setDragOverField(null);
  };

  const handleDragStart = (e: React.DragEvent, variable: string) => {
    e.dataTransfer.setData("text/plain", variable);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleDrop = (e: React.DragEvent, field: "body" | "subject") => {
    e.preventDefault();
    const variable = e.dataTransfer.getData("text/plain");
    if (variable && variables.some(v => v.key === variable)) {
      insertVariable(variable, field);
    }
    setDragOverField(null);
  };

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
      
      const name = contact ? contact.name : "Productor";
      const trackName = contact ? contact.track : "Track";
      const bpmValue = contact ? contact.bpm : "BPM";
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
      const space = document.createTextNode("\u200B");
      span.after(space);
      range.setStartAfter(space);
      range.setEndAfter(space);
      
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
    setDragOverField(null);
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
        const name = contact ? contact.name : "Productor";
        const trackName = contact ? contact.track : "Track";
        const bpmValue = contact ? contact.bpm : "BPM";
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
        const space = document.createTextNode("\u200B");
        span.after(space);
        range.setStartAfter(space);
        range.setEndAfter(space);
        
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
        const name = contact ? contact.name : "Productor";
        const trackName = contact ? contact.track : "Track";
        const bpmValue = contact ? contact.bpm : "BPM";
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
        const space = document.createTextNode("\u200B");
        span.after(space);
        range.setStartAfter(space);
        range.setEndAfter(space);
        
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

  const handleBodySelect = () => { if (bodyRef && bodyRef.selectionStart != null) setBodyCursor(bodyRef.selectionStart); };
  const handleSubjectSelect = () => { if (subjectRef && subjectRef.selectionStart != null) setSubjectCursor(subjectRef.selectionStart); };

  const VariableChips = ({ target }: { target: "email" | "template" }) => {
    const disabled = target === "email" && isAlreadySent;
    return (
      <div className={cn("flex gap-1.5 flex-wrap mb-2", disabled && "opacity-50 pointer-events-none")}>
        {variables.map((v) => (
          <span
            key={v.key}
            draggable={!disabled}
            onDragStart={(e) => {
              if (disabled) {
                e.preventDefault();
                return;
              }
              handleDragStart(e, v.key);
            }}
            onClick={() => {
              if (disabled) return;
              if (target === "email") {
                insertEmailVariable(v.key, lastActiveField);
              } else {
                insertVariable(v.key, "body");
              }
            }}
            className={cn(
              "text-[10px] px-2 py-0.5 rounded border transition-colors select-none",
              disabled ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing hover:border-emerald-500 hover:bg-emerald-500/5"
            )}
            style={{ borderColor: "var(--border)", color: "var(--text-muted)", background: "transparent" }}
            title={v.desc}
          >
            +{v.label}
          </span>
        ))}
        {!disabled && <span className="text-[9px] text-muted self-center ml-1">{t("crm.drag_hint")}</span>}
      </div>
    );
  };

  const fetchTemplates = async () => {
    try {
      const res = await fetch("/api/email/templates", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setDbTemplates(data);
      }
    } catch (e) { console.error("Error fetching templates", e); }
  };

  useEffect(() => {
    if (activeTab === "templates") fetchTemplates();
  }, [activeTab]);

  const handleSaveTemplate = async () => {
    setSavingTemplate(true);
    const labelId = localStorage.getItem("label_id");
    try {
      const res = await fetch("/api/email/templates", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label_id: labelId,
          name: templateName,
          template_type: templateType,
          subject_template: templateSubjectState.value,
          body_template: templateBodyState.value,
        }),
      });
      if (res.ok) {
        setTemplateName("");
        setTemplateType("rejection");
        templateSubjectState.reset();
        templateBodyState.reset();
        fetchTemplates();
      }
    } catch (e) { console.error("Error saving template", e); }
    finally { setSavingTemplate(false); }
  };

  if (loading) {
    return (
      <div className="w-full max-w-[1700px] mx-auto px-6 py-8 animate-pulse">
        <div className="h-6 bg-zinc-800 rounded w-32 mb-6 animate-pulse" />
        
        {/* Main split-screen box matching the actual design */}
        <div className="rounded border border-[var(--border)] overflow-hidden bg-[var(--bg-secondary)]">
          <div className="grid grid-cols-5" style={{ minHeight: "650px" }}>
            
            {/* Left side list skeleton (2 cols) */}
            <div className="col-span-2 border-r border-[var(--border)] space-y-4">
              <div className="px-4 py-3 border-b border-[var(--border)] space-y-3">
                {/* Search / Tab bar skeletons */}
                <div className="h-4 bg-zinc-800 rounded w-24 mb-1" />
                <div className="flex gap-2">
                  <div className="h-6 bg-zinc-900 rounded w-16" />
                  <div className="h-6 bg-zinc-900 rounded w-20" />
                </div>
              </div>
              
              {/* Contact list item skeletons */}
              <div className="divide-y divide-[var(--border-light)] px-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="px-4 py-4 space-y-2 opacity-75" style={{ animationDelay: `${i * 100}ms` }}>
                    <div className="flex justify-between items-center">
                      <div className="h-4 bg-zinc-800 rounded w-1/3 animate-pulse" />
                      <div className="h-4 bg-zinc-900 rounded w-12 animate-pulse" />
                    </div>
                    <div className="h-3 bg-zinc-900 rounded w-2/3" />
                  </div>
                ))}
              </div>
            </div>

            {/* Right side detail pane skeleton (3 cols) */}
            <div className="col-span-3 p-6 space-y-6">
              {/* Contact header skeleton */}
              <div className="pb-5 border-b border-[var(--border)] space-y-3">
                <div className="flex justify-between items-start">
                  <div className="space-y-2 w-1/2">
                    <div className="h-5 bg-zinc-800 rounded w-2/3" />
                    <div className="h-3 bg-zinc-900 rounded w-full" />
                  </div>
                  <div className="h-8 bg-zinc-900 rounded w-24" />
                </div>
              </div>

              {/* Email composer skeleton */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="h-3 bg-zinc-800 rounded w-20 animate-pulse" />
                  <div className="h-6 bg-zinc-900 rounded-lg w-full flex items-center gap-1.5 px-3">
                    <div className="h-2 w-2 rounded bg-emerald-500 animate-pulse" />
                    <div className="h-3 bg-zinc-900 rounded w-32" />
                  </div>
                </div>
                
                {/* Email inputs */}
                <div className="space-y-2">
                  <div className="h-3 bg-zinc-800 rounded w-16" />
                  <div className="h-9 bg-zinc-950 rounded border border-zinc-900 w-full animate-pulse" />
                </div>
                <div className="space-y-2">
                  <div className="h-3 bg-zinc-800 rounded w-16" />
                  <div className="h-48 bg-zinc-950 rounded border border-zinc-900 w-full animate-pulse" />
                </div>

                {/* Send button block skeleton */}
                <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-light)] animate-pulse">
                  <div className="h-9 bg-zinc-900 rounded w-24" />
                  <div className="h-9 bg-zinc-800 rounded w-32" />
                </div>
              </div>
            </div>
            
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full max-w-[1700px] mx-auto px-6 py-8">
        <h1 className="font-display font-semibold text-xl mb-6">{t("crm.title")}</h1>
        <div className="rounded border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <p className="text-sm" style={{ color: "#ef4444" }}>{t("crm.error_load")}: {error}</p>
          <button onClick={() => { setLoading(true); setError(null); }} className="mt-4 px-4 py-2 rounded text-sm font-medium" style={{ background: "#10b981", color: "#09090b" }}>{t("crm.retry")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1700px] mx-auto px-6 py-8 relative">
      {isFree && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center mx-6 my-8" style={{ pointerEvents: "auto" }}>
          <div className="text-center p-8 rounded border max-w-sm" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
            <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center" style={{ background: "rgba(16,185,129,0.1)" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="1.5">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h3 className="text-base font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Plan Indie o Pro</h3>
            <p className="text-xs text-muted mb-5">Los emails están disponibles en los planes Indie y Pro. Hacé upgrade para contactar productores.</p>
            <Link href="/settings" className="inline-block px-5 py-2 text-sm font-medium rounded transition-all hover:opacity-90 cursor-pointer" style={{ background: "#10b981", color: "#09090b" }}>
              Ver planes
            </Link>
          </div>
        </div>
      )}
      <div style={isFree ? { filter: "blur(4px)", pointerEvents: "none", userSelect: "none" } : undefined}>
      <style>{`
        @keyframes breathe {
          0% { box-shadow: inset 0 0 0 rgba(16,185,129,0); }
          20% { box-shadow: inset 0 0 14px rgba(16,185,129,0.18); }
          40% { box-shadow: inset 0 0 6px rgba(16,185,129,0.08); }
          60% { box-shadow: inset 0 0 14px rgba(16,185,129,0.18); }
          80% { box-shadow: inset 0 0 6px rgba(16,185,129,0.08); }
          100% { box-shadow: inset 0 0 0 rgba(16,185,129,0); }
        }
      `}</style>
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display font-semibold text-xl">{t("crm.title")}</h1>
        <div className="flex gap-1 p-1 rounded-lg border" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <button 
            onClick={() => setActiveTab("bandeja")}
            className={cn("px-4 py-1.5 rounded-md text-xs font-medium transition-all", activeTab === "bandeja" ? "shadow-sm" : "text-muted hover:text-primary")}
            style={activeTab === "bandeja" ? { background: "#10b981", color: "#09090b" } : {}}
          >
            Bandeja
          </button>
          <button 
            onClick={() => setActiveTab("templates")}
            className={cn("px-4 py-1.5 rounded-md text-xs font-medium transition-all", activeTab === "templates" ? "shadow-sm" : "text-muted hover:text-primary")}
            style={activeTab === "templates" ? { background: "#10b981", color: "#09090b" } : {}}
          >
            Crear plantilla
          </button>
        </div>
      </div>

      {/* ── Reply-To Email Config Card ─────────────────────────── */}
      <div className="mb-5 rounded-xl border px-5 py-4 flex items-center gap-4" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
        {/* Icon */}
        <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(16,185,129,0.12)" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        {/* Label + input */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "#10b981" }}>Reply-To</span>
            {replyToSaved && (
              <span className="text-[10px] font-medium flex items-center gap-1" style={{ color: "#10b981" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                Guardado
              </span>
            )}
          </div>
          {replyToEditing ? (
            <div className="flex items-center gap-2">
              <input
                id="crm-reply-to-input"
                type="email"
                autoFocus
                value={replyToInput}
                onChange={(e) => setReplyToInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveReplyTo(); if (e.key === "Escape") { setReplyToEditing(false); setReplyToInput(replyToEmail); } }}
                placeholder={ownerEmail || "ej. booking@tusello.com"}
                className="flex-1 bg-transparent outline-none text-sm font-mono border-b pb-0.5 transition-colors min-w-0"
                style={{ borderColor: "#10b981", color: "var(--text-primary)" }}
              />
              <button
                onClick={handleSaveReplyTo}
                disabled={replyToSaving}
                className="px-3 py-1 rounded-md text-xs font-medium transition-all disabled:opacity-50"
                style={{ background: "#10b981", color: "#09090b" }}
              >
                {replyToSaving ? "..." : "Guardar"}
              </button>
              <button
                onClick={() => { setReplyToEditing(false); setReplyToInput(replyToEmail); }}
                className="px-2 py-1 rounded-md text-xs font-medium text-muted hover:text-primary transition-colors"
                style={{ background: "var(--bg-tertiary)" }}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              id="crm-reply-to-edit-btn"
              onClick={() => { setReplyToEditing(true); setReplyToInput(replyToEmail); }}
              className="flex items-center gap-2 group text-left w-full"
            >
              <span className={cn("text-sm font-mono truncate", replyToEmail ? "" : "text-muted italic")} style={{ color: replyToEmail ? "var(--text-primary)" : undefined }}>
                {replyToEmail || (ownerEmail ? ownerEmail : "Sin configurar")}
              </span>
              {!replyToEmail && ownerEmail && (
                <span className="text-[10px] text-muted">(usando email de registro)</span>
              )}
              <svg className="opacity-0 group-hover:opacity-60 transition-opacity flex-shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          )}
        </div>
        {!replyToEditing && (
          <button
            onClick={() => { setReplyToEditing(true); setReplyToInput(replyToEmail); }}
            className="flex-shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-all hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)", background: "var(--bg-tertiary)" }}
          >
            Editar
          </button>
        )}
      </div>
      {/* ── End Reply-To Card ──────────────────────────────────── */}


      {activeTab === "bandeja" ? (
        <div className="rounded border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <div className="grid grid-cols-5" style={{ minHeight: "500px" }}>
            {/* Left Sidebar - Contacts */}
            <div className="col-span-2 border-r flex flex-col" style={{ borderColor: "var(--border)" }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">{t("crm.contacts_label")}</div>
                <div className="flex gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>{rejectionCount} {t("crm.rejections")}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}>{approvalCount} {t("crm.approvals")}</span>
                </div>
              </div>
              <div className="overflow-y-auto flex-1" style={{ maxHeight: "680px" }}>
                {contacts.length > 0 ? contacts.map((c, i) => {
                  const isHighlighted = highlightedId === c.id;

                  return (
                    <div key={i} id={`crm-contact-${c.id}`} onClick={() => handleContactChange(i)} className="w-full text-left px-4 py-3 border-b cursor-pointer transition-none" style={{ borderColor: "var(--border-light)", background: selectedContact === i ? "rgba(16,185,129,0.08)" : "transparent", animation: isHighlighted ? "breathe 1.2s ease-in-out 1 forwards" : "none" }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium truncate">{c.name}</span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ml-2" style={{ background: c.status === "rejected" ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.15)", color: c.status === "rejected" ? "#ef4444" : "#10b981" }}>
                          {c.status === "rejected" ? t("crm.rejected") : t("crm.approved")}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted truncate">{c.email || t("crm.no_email_contact")}</div>
                      <div className="flex items-center gap-2 mt-1">
                        {c.mp3_path && (
                          <button onClick={(e) => { e.stopPropagation(); if (currentTrack?.id === c.id) { togglePlay(); } else { playTrack({ id: c.id, track_name: c.track, producer_name: c.name, mp3_path: c.mp3_path }); } }} className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 hover:bg-white/10 transition-colors" title={currentTrack?.id === c.id && isPlaying ? "Pausar" : "Reproducir"} style={{ color: currentTrack?.id === c.id ? "#10b981" : "var(--text-secondary)" }}>
                            {currentTrack?.id === c.id && isPlaying ? (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                            ) : (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                            )}
                          </button>
                        )}
                        <span className="text-[10px] text-muted">"{c.track}"</span>
                        <Link href={`/inbox?highlight=${c.id}`} className="text-[10px] hover:underline" style={{ color: "#10b981" }} onClick={(e) => e.stopPropagation()} title="Ver demo">{t("crm.view_demo")}</Link>
                        {c.sent && (
                          <span className="font-mono text-[9px] px-1.5 py-0.5 rounded font-semibold cursor-default select-none border border-emerald-500/30" style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}>
                            {t("crm.sent")}!
                          </span>
                        )}
                        {!c.sent && <span className="text-[10px] text-muted">{t("crm.pending_email")}</span>}
                      </div>
                    </div>
                  );
                }) : (
                  <div className="py-12 text-center text-muted text-sm">{t("crm.no_contacts")}</div>
                )}
              </div>
            </div>

            {/* Right Panel - Email Composer */}
            <div className="col-span-3 flex flex-col">
              <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">{t("crm.template_label")}</div>
                <div className="flex gap-1.5 flex-wrap">
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      disabled={isAlreadySent}
                      onClick={() => handleTemplateChange(tpl.id)}
                      className="text-[10px] px-2.5 py-1 rounded border transition-colors disabled:opacity-50"
                      style={{
                        borderColor: selectedTemplate === tpl.id ? "#10b981" : "var(--border)",
                        color: selectedTemplate === tpl.id ? "#10b981" : "var(--text-muted)",
                        background: selectedTemplate === tpl.id ? "rgba(16,185,129,0.08)" : "transparent"
                      }}
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 p-4 flex flex-col">
                <div className="mb-3">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1 block">{t("crm.to_label")}</label>
                  {contact ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-sm font-medium">
                        {contact.name} {contact.email ? <span className="text-muted">&lt;{contact.email}&gt;</span> : <span className="text-muted">({t("crm.no_email")})</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        {contact.producer_instagram && (
                          <a
                            href={`https://instagram.com/${contact.producer_instagram.replace(/^@/, "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-5 h-5 rounded flex items-center justify-center transition-colors hover:bg-white/10"
                            style={{ color: "#10b981" }}
                            title={`Instagram: @${contact.producer_instagram.replace(/^@/, "")}`}
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" /></svg>
                          </a>
                        )}
                        {contact.producer_soundcloud && (
                          <a
                            href={`https://soundcloud.com/${contact.producer_soundcloud}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-5 h-5 rounded flex items-center justify-center transition-colors hover:bg-white/10"
                            style={{ color: "#f97316" }}
                            title={`SoundCloud: ${contact.producer_soundcloud}`}
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-.55 0-1 .45-1 1v7c0 .55.45 1 1 1s1-.45 1-1v-7c0-.55-.45-1-1-1zm3-2c-.55 0-1 .45-1 1v9c0 .55.45 1 1 1s1-.45 1-1V8c0-.55-.45-1-1-1zm3 2c-.55 0-1 .45-1 1v7c0 .55.45 1 1 1s1-.45 1-1v-7c0-.55-.45-1-1-1zm3 2c-.55 0-1 .45-1 1v5c0 .55.45 1 1 1s1-.45 1-1v-5c0-.55-.45-1-1-1zM9 11c-.55 0-1 .45-1 1v5c0 .55.45 1 1 1s1-.45 1-1v-5c0-.55-.45-1-1-1zm-3 2c-.55 0-1 .45-1 1v3c0 .55.45 1 1 1s1-.45 1-1v-3c0-.55-.45-1-1-1zm-3 1c-.55 0-1 .45-1 1v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1z" /></svg>
                          </a>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted">{t("crm.no_contact")}</div>
                  )}
                </div>

                <div className="mb-3">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1 block">{t("crm.subject_label")}</label>
                  <VariableChips target="email" />
                  <div
                    ref={emailSubjectDivRef}
                    contentEditable={!isAlreadySent}
                    suppressContentEditableWarning
                    onInput={handleEmailSubjectInput}
                    onKeyDown={handleEmailSubjectKeyDown}
                    onFocus={() => setLastActiveField("subject")}
                    onDragOver={handleEmailSubjectDragOver}
                    onDragLeave={handleEmailSubjectDragLeave}
                    onDrop={handleEmailSubjectDrop}
                    className="w-full px-3 py-2 rounded border text-sm bg-transparent overflow-hidden whitespace-nowrap focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                    style={{
                      borderColor: dragOverField === "email-subject" ? "#10b981" : "var(--border)",
                      boxShadow: dragOverField === "email-subject" ? "0 0 8px rgba(16,185,129,0.2)" : "none",
                      caretColor: "#10b981",
                    }}
                  />
                </div>

                <div className="mb-4">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1 block">{t("crm.body_label")}</label>
                  <VariableChips target="email" />
                  <div
                    ref={emailBodyDivRef}
                    contentEditable={!isAlreadySent}
                    suppressContentEditableWarning
                    onInput={handleEmailBodyInput}
                    onFocus={() => setLastActiveField("body")}
                    onDragOver={handleEmailBodyDragOver}
                    onDragLeave={handleEmailBodyDragLeave}
                    onDrop={handleEmailBodyDrop}
                    className="w-full px-3 py-2 rounded border text-sm leading-relaxed bg-transparent overflow-y-auto focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                    style={{
                      borderColor: dragOverField === "email-body" ? "#10b981" : "var(--border)",
                      boxShadow: dragOverField === "email-body" ? "0 0 8px rgba(16,185,129,0.2)" : "none",
                      minHeight: "220px",
                      caretColor: "#10b981",
                    }}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 mt-4">
                  <div className="text-xs text-muted">
                    {isAlreadySent ? <span style={{ color: "#10b981" }}>{t("crm.sent_msg")} {contact?.name}</span> : sendError ? <span style={{ color: "#ef4444" }}>{sendError}</span> : <span>{t("crm.variables")}</span>}
                  </div>
                  <button onClick={handleSendEmail} disabled={sending || isAlreadySent} className="px-5 py-2 rounded text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50" style={{ background: isAlreadySent ? "var(--border)" : "#10b981", color: isAlreadySent ? "var(--text-muted)" : "#09090b" }}>
                    {sending ? t("crm.sending") : isAlreadySent ? t("crm.sent") : t("crm.send")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Form Create */}
          <div className="rounded border p-6" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
            <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
              Nueva Plantilla
            </h2>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Nombre</label>
                <input 
                  type="text" 
                  value={templateName} 
                  onChange={(e) => setTemplateName(e.target.value)}
                  className="w-full px-3 py-2 rounded border text-sm bg-transparent" 
                  placeholder="Ej: Rechazo por Tempo"
                  style={{ borderColor: "var(--border)" }} 
                />
              </div>
              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Tipo</label>
                <select 
                  value={templateType}
                  onChange={(e) => setTemplateType(e.target.value)}
                  className="w-full px-3 py-2 rounded border text-sm bg-transparent" 
                  style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
                >
                  <option value="rejection">Rechazo</option>
                  <option value="approval">Aprobación</option>
                  <option value="followup">Seguimiento</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Asunto</label>
                <VariableChips target="template" />
                <input 
                  ref={setSubjectRef}
                  type="text" 
                  value={templateSubjectState.value}
                  onChange={(e) => templateSubjectState.set(e.target.value)}
                  onDragOver={(e) => handleDragOverField(e, "template-subject")}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, "subject")}
                  onSelect={handleSubjectSelect}
                  onClick={handleSubjectSelect}
                  className="w-full px-3 py-2 rounded border text-sm bg-transparent" 
                  placeholder="Asunto del email..."
                  style={{ borderColor: "var(--border)", caretColor: "#10b981" }} 
                />
              </div>
              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Cuerpo</label>
                <VariableChips target="template" />
                <textarea 
                  ref={setBodyRef}
                  value={templateBodyState.value}
                  onChange={(e) => templateBodyState.set(e.target.value)}
                  onDragOver={(e) => handleDragOverField(e, "template-body")}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, "body")}
                  onSelect={handleBodySelect}
                  onClick={handleBodySelect}
                  className="w-full px-3 py-2 rounded border text-sm bg-transparent resize-none" 
                  rows={6}
                  placeholder="Hola {producer}, recibimos {track}..."
                  style={{ borderColor: "var(--border)", caretColor: "#10b981" }} 
                />
              </div>
              <button 
                onClick={handleSaveTemplate}
                disabled={savingTemplate || !templateName}
                className="w-full py-2 rounded text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: "#10b981", color: "#09090b" }}
              >
                {savingTemplate ? "Guardando..." : "Guardar Plantilla"}
              </button>
            </div>
          </div>

          {/* List templates */}
          <div className="rounded border p-6 flex flex-col" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
            <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v16H4zM4 9h16M9 4v16"/></svg>
              Tus Plantillas
            </h2>
            <div className="space-y-3 flex-1 overflow-y-auto max-h-[500px] pr-2">
              {dbTemplates.length > 0 ? dbTemplates.map((tpl: any) => (
                <div key={tpl.id} className="p-3 rounded border text-sm group" style={{ borderColor: "var(--border-light)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{tpl.name}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded uppercase font-mono" style={{ background: "rgba(161,161,170,0.1)", color: "var(--text-muted)" }}>
                      {tpl.template_type}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted truncate mb-2">{tpl.subject_template}</div>
                  <button 
                    onClick={() => {
                      setTemplateName(tpl.name);
                      setTemplateType(tpl.template_type);
                      templateSubjectState.reset();
                      templateSubjectState.set(convertHtmlToText(tpl.subject_template));
                      templateBodyState.reset();
                      templateBodyState.set(convertHtmlToText(tpl.body_template));
                    }}
                    className="text-[10px] text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Editar
                  </button>
                </div>
              )) : (
                <div className="text-center py-12 text-muted text-xs">
                  No tenés plantillas personalizadas todavía.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

export default function CRMPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-[1700px] mx-auto px-6 py-8"><div className="animate-pulse h-96 rounded" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }} /></div>}>
      <CRMContent />
    </Suspense>
  );
}
