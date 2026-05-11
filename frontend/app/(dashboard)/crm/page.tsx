"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { cn } from "@/lib/utils";
import { usePlayer } from "@/lib/PlayerContext";
import { useLanguage } from "@/lib/i18n";

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

function CRMContent() {
  const { t } = useLanguage();
  const [selectedTemplate, setSelectedTemplate] = useState("reject-phase");
  const [selectedContact, setSelectedContact] = useState(0);
  const [emailBody, setEmailBody] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [sent, setSent] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [labelName, setLabelName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const { playTrack, togglePlay, isPlaying, currentTrack } = usePlayer();
  const searchParams = useSearchParams();
  const highlightParam = searchParams.get("highlight");

  useEffect(() => {
    const fetchData = async () => {
      const slug = localStorage.getItem("slug");
      if (slug) {
        try {
          const res = await fetch(`/api/labels/${slug}`, { credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            setLabelName(data.name);
          }
        } catch { setLabelName(slug); }
      }
      try {
        const res = await fetch(`/api/submissions`, { credentials: "include" });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data: Submission[] = await res.json();
        const resolved = data.filter((s) => s.status !== "pending");
        const mapped: Contact[] = resolved.map((s) => ({
          id: s.id, name: s.producer_name || "Anónimo", email: s.producer_email || "",
          track: s.track_name || "Sin nombre", status: s.status as "approved" | "rejected",
          bpm: s.bpm != null ? String(Math.round(s.bpm)) : "—", sent: false, mp3_path: s.mp3_path || null,
        }));
        setContacts(mapped);
      } catch (e) { setError(e instanceof Error ? e.message : t("inbox.error_unknown")); }
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (highlightParam && contacts.length > 0) {
      const idx = contacts.findIndex((c) => c.id === highlightParam);
      if (idx >= 0) {
        setSelectedContact(idx);
        setTimeout(() => {
          const el = document.getElementById(`crm-contact-${highlightParam}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 200);
      }
    }
  }, [highlightParam, contacts]);

  const templates = buildTemplates(labelName || "tu sello", t);
  const contact = contacts[selectedContact];
  const template = templates.find((t) => t.id === selectedTemplate);

  const resolveTemplate = (tpl: Template, c: Contact) => {
    return tpl.body.replace(/{producer}/g, c.name).replace(/{track}/g, c.track).replace(/{bpm}/g, c.bpm);
  };

  const handleTemplateChange = (id: string) => {
    setSelectedTemplate(id);
    const tpl = templates.find((t) => t.id === id)!;
    setEmailSubject(tpl.subject);
    if (contact) setEmailBody(resolveTemplate(tpl, contact));
    else setEmailBody(tpl.body);
    setSent(false);
  };

  const handleContactChange = (idx: number) => {
    setSelectedContact(idx);
    const tpl = templates.find((t) => t.id === selectedTemplate)!;
    const c = contacts[idx];
    if (c) setEmailBody(resolveTemplate(tpl, c));
    else setEmailBody(tpl.body);
    setSent(false);
  };

  useEffect(() => {
    if (template && contacts.length > 0 && !emailBody) {
      setEmailSubject(template.subject);
      setEmailBody(resolveTemplate(template, contacts[0]));
    }
  }, [template, contacts, labelName]);

  const handleSendEmail = async () => {
    if (!contact) return;
    if (!contact.email) { setSendError(t("crm.send_error_no_email")); return; }
    setSending(true); setSendError(null);
    try {
      const res = await fetch(`/api/email/send`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: contact.email, subject: emailSubject, body: emailBody, from_name: labelName }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.detail || `Error ${res.status}`); }
      setSent(true);
      setContacts((prev) => prev.map((c, i) => (i === selectedContact ? { ...c, sent: true } : c)));
    } catch (e) { setSendError(e instanceof Error ? e.message : t("crm.send_error")); }
    finally { setSending(false); }
  };

  const rejectionCount = contacts.filter((c) => c.status === "rejected").length;
  const approvalCount = contacts.filter((c) => c.status === "approved").length;
  const plan = typeof window !== "undefined" ? localStorage.getItem("plan") : "free";
  const isFree = plan === "free" || !plan;

  const [activeTab, setActiveTab] = useState<"bandeja" | "templates">("bandeja");
  const [dbTemplates, setDbTemplates] = useState<any[]>([]);
  const [templateForm, setTemplateForm] = useState({ name: "", type: "rejection", subject: "", body: "" });
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [bodyCursor, setBodyCursor] = useState(0);
  const [subjectCursor, setSubjectCursor] = useState(0);
  const [bodyRef, setBodyRef] = useState<HTMLTextAreaElement | null>(null);
  const [subjectRef, setSubjectRef] = useState<HTMLInputElement | null>(null);
  const [emailBodyRef, setEmailBodyRef] = useState<HTMLTextAreaElement | null>(null);
  const [emailSubjectRef, setEmailSubjectRef] = useState<HTMLInputElement | null>(null);
  const [emailBodyCursor, setEmailBodyCursor] = useState(0);
  const [emailSubjectCursor, setEmailSubjectCursor] = useState(0);

  const variables = [
    { key: "{producer}", label: "Productor", desc: "Nombre del productor" },
    { key: "{track}", label: "Track", desc: "Nombre del track" },
    { key: "{bpm}", label: "BPM", desc: "Tempo del track" },
    { key: "{label}", label: "Sello", desc: "Nombre del sello" },
  ];

  const insertVariable = (variable: string, field: "body" | "subject") => {
    if (field === "body" && bodyRef) {
      const pos = bodyCursor;
      const before = templateForm.body.slice(0, pos);
      const after = templateForm.body.slice(pos);
      setTemplateForm({ ...templateForm, body: before + variable + after });
      const newPos = pos + variable.length;
      setTimeout(() => { bodyRef.focus(); bodyRef.setSelectionRange(newPos, newPos); }, 0);
    } else if (field === "subject" && subjectRef) {
      const pos = subjectCursor;
      const before = templateForm.subject.slice(0, pos);
      const after = templateForm.subject.slice(pos);
      setTemplateForm({ ...templateForm, subject: before + variable + after });
      const newPos = pos + variable.length;
      setTimeout(() => { subjectRef.focus(); subjectRef.setSelectionRange(newPos, newPos); }, 0);
    }
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
  };

  const insertEmailVariable = (variable: string, field: "body" | "subject") => {
    if (field === "body" && emailBodyRef) {
      const pos = emailBodyCursor;
      const before = emailBody.slice(0, pos);
      const after = emailBody.slice(pos);
      setEmailBody(before + variable + after);
      const newPos = pos + variable.length;
      setTimeout(() => { emailBodyRef.focus(); emailBodyRef.setSelectionRange(newPos, newPos); }, 0);
    } else if (field === "subject" && emailSubjectRef) {
      const pos = emailSubjectCursor;
      const before = emailSubject.slice(0, pos);
      const after = emailSubject.slice(pos);
      setEmailSubject(before + variable + after);
      const newPos = pos + variable.length;
      setTimeout(() => { emailSubjectRef.focus(); emailSubjectRef.setSelectionRange(newPos, newPos); }, 0);
    }
  };

  const handleEmailDrop = (e: React.DragEvent, field: "body" | "subject") => {
    e.preventDefault();
    const variable = e.dataTransfer.getData("text/plain");
    if (variable && variables.some(v => v.key === variable)) {
      insertEmailVariable(variable, field);
    }
  };

  const handleBodySelect = () => { if (bodyRef) setBodyCursor(bodyRef.selectionStart); };
  const handleSubjectSelect = () => { if (subjectRef) setSubjectCursor(subjectRef.selectionStart); };
  const handleEmailBodySelect = () => { if (emailBodyRef) setEmailBodyCursor(emailBodyRef.selectionStart); };
  const handleEmailSubjectSelect = () => { if (emailSubjectRef) setEmailSubjectCursor(emailSubjectRef.selectionStart); };

  const VariableChips = ({ target }: { target: "email" | "template" }) => (
    <div className="flex gap-1.5 flex-wrap mb-2">
      {variables.map((v) => (
        <span
          key={v.key}
          draggable
          onDragStart={(e) => handleDragStart(e, v.key)}
          className="text-[10px] px-2 py-0.5 rounded border cursor-grab active:cursor-grabbing transition-colors hover:border-emerald-500 select-none"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)", background: "transparent" }}
          title={v.desc}
        >
          +{v.label}
        </span>
      ))}
      <span className="text-[9px] text-muted self-center ml-1">{t("crm.drag_hint")}</span>
    </div>
  );

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
          name: templateForm.name,
          template_type: templateForm.type,
          subject_template: templateForm.subject,
          body_template: templateForm.body,
        }),
      });
      if (res.ok) {
        setTemplateForm({ name: "", type: "rejection", subject: "", body: "" });
        fetchTemplates();
      }
    } catch (e) { console.error("Error saving template", e); }
    finally { setSavingTemplate(false); }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="font-display font-semibold text-xl mb-6">{t("crm.title")}</h1>
        <div className="rounded border overflow-hidden animate-pulse" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <div className="grid grid-cols-5" style={{ minHeight: "500px" }}>
            <div className="col-span-2 border-r" style={{ borderColor: "var(--border)" }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                <div className="h-3 w-24 rounded mb-2" style={{ background: "var(--border-light)" }} />
                <div className="flex gap-2"><div className="h-4 w-16 rounded" style={{ background: "var(--border-light)" }} /><div className="h-4 w-16 rounded" style={{ background: "var(--border-light)" }} /></div>
              </div>
              {[0, 1, 2].map((i) => (
                <div key={i} className="px-4 py-3 border-b" style={{ borderColor: "var(--border-light)" }}>
                  <div className="flex items-center justify-between mb-1"><div className="h-3 w-20 rounded" style={{ background: "var(--border-light)" }} /><div className="h-3 w-14 rounded" style={{ background: "var(--border-light)" }} /></div>
                  <div className="h-2 w-32 rounded" style={{ background: "var(--border-light)" }} />
                </div>
              ))}
            </div>
            <div className="col-span-3 p-4">
              <div className="h-3 w-16 rounded mb-3" style={{ background: "var(--border-light)" }} />
              <div className="h-8 w-full rounded mb-3" style={{ background: "var(--border-light)" }} />
              <div className="h-8 w-full rounded mb-3" style={{ background: "var(--border-light)" }} />
              <div className="h-40 w-full rounded" style={{ background: "var(--border-light)" }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="font-display font-semibold text-xl mb-6">{t("crm.title")}</h1>
        <div className="rounded border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <p className="text-sm" style={{ color: "#ef4444" }}>{t("crm.error_load")}: {error}</p>
          <button onClick={() => { setLoading(true); setError(null); }} className="mt-4 px-4 py-2 rounded text-sm font-medium" style={{ background: "#10b981", color: "#09090b" }}>{t("crm.retry")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 relative">
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
      <div className="flex items-center justify-between mb-6">
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

      {activeTab === "bandeja" ? (
        <div className="rounded border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <div className="grid grid-cols-5" style={{ minHeight: "500px" }}>
            {/* Left Sidebar - Contacts */}
            <div className="col-span-2 border-r" style={{ borderColor: "var(--border)" }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">{t("crm.contacts_label")}</div>
                <div className="flex gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>{rejectionCount} {t("crm.rejections")}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}>{approvalCount} {t("crm.approvals")}</span>
                </div>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: "450px" }}>
                {contacts.length > 0 ? contacts.map((c, i) => {
                  const isHighlighted = highlightParam === c.id;

                  return (
                    <div key={i} id={`crm-contact-${c.id}`} onClick={() => handleContactChange(i)} className="w-full text-left px-4 py-3 border-b transition-all duration-500 cursor-pointer" style={{ borderColor: "var(--border-light)", background: isHighlighted ? "rgba(16,185,129,0.08)" : selectedContact === i ? "rgba(16,185,129,0.04)" : "transparent", animation: isHighlighted ? "breathe 1.2s ease-in-out 1 forwards" : "none", transition: "background 1.5s ease-out" }}>
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
                        {c.sent && <span className="text-[10px]" style={{ color: "#10b981" }}>{t("crm.sent_label")}</span>}
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
                    <button key={tpl.id} onClick={() => handleTemplateChange(tpl.id)} className="text-[10px] px-2.5 py-1 rounded border transition-colors" style={{ borderColor: selectedTemplate === tpl.id ? "#10b981" : "var(--border)", color: selectedTemplate === tpl.id ? "#10b981" : "var(--text-muted)", background: selectedTemplate === tpl.id ? "rgba(16,185,129,0.08)" : "transparent" }}>
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 p-4 flex flex-col">
                <div className="mb-3">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1 block">{t("crm.to_label")}</label>
                  {contact ? (
                    <div className="text-sm font-medium">{contact.name} {contact.email ? <span className="text-muted">&lt;{contact.email}&gt;</span> : <span className="text-muted">({t("crm.no_email")})</span>}</div>
                  ) : (
                    <div className="text-sm text-muted">{t("crm.no_contact")}</div>
                  )}
                </div>

                <div className="mb-3">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1 block">{t("crm.subject_label")}</label>
                  <VariableChips target="email" />
                  <input ref={setEmailSubjectRef} type="text" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleEmailDrop(e, "subject")} onSelect={handleEmailSubjectSelect} onClick={handleEmailSubjectSelect} className="w-full px-3 py-2 rounded border text-sm bg-transparent" style={{ borderColor: "var(--border)" }} />
                </div>

                <div className="mb-4">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1 block">{t("crm.body_label")}</label>
                  <VariableChips target="email" />
                  <textarea ref={setEmailBodyRef} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleEmailDrop(e, "body")} onSelect={handleEmailBodySelect} onClick={handleEmailBodySelect} className="w-full px-3 py-2 rounded border text-sm leading-relaxed bg-transparent resize-none" style={{ borderColor: "var(--border)", minHeight: "200px" }} rows={8} />
                </div>

                <div className="flex items-center justify-between gap-3 mt-4">
                  <div className="text-xs text-muted">
                    {sent ? <span style={{ color: "#10b981" }}>{t("crm.sent_msg")} {contact?.name}</span> : sendError ? <span style={{ color: "#ef4444" }}>{sendError}</span> : <span>{t("crm.variables")}</span>}
                  </div>
                  <button onClick={handleSendEmail} disabled={sending} className="px-5 py-2 rounded text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50" style={{ background: sent ? "var(--border)" : "#10b981", color: sent ? "var(--text-muted)" : "#09090b" }}>
                    {sending ? t("crm.sending") : sent ? t("crm.sent") : t("crm.send")}
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
                  value={templateForm.name} 
                  onChange={(e) => setTemplateForm({...templateForm, name: e.target.value})}
                  className="w-full px-3 py-2 rounded border text-sm bg-transparent" 
                  placeholder="Ej: Rechazo por Tempo"
                  style={{ borderColor: "var(--border)" }} 
                />
              </div>
              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Tipo</label>
                <select 
                  value={templateForm.type}
                  onChange={(e) => setTemplateForm({...templateForm, type: e.target.value})}
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
                  value={templateForm.subject}
                  onChange={(e) => setTemplateForm({...templateForm, subject: e.target.value})}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, "subject")}
                  onSelect={handleSubjectSelect}
                  onClick={handleSubjectSelect}
                  className="w-full px-3 py-2 rounded border text-sm bg-transparent" 
                  placeholder="Asunto del email..."
                  style={{ borderColor: "var(--border)" }} 
                />
              </div>
              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Cuerpo</label>
                <VariableChips target="template" />
                <textarea 
                  ref={setBodyRef}
                  value={templateForm.body}
                  onChange={(e) => setTemplateForm({...templateForm, body: e.target.value})}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, "body")}
                  onSelect={handleBodySelect}
                  onClick={handleBodySelect}
                  className="w-full px-3 py-2 rounded border text-sm bg-transparent resize-none" 
                  rows={6}
                  placeholder="Hola {producer}, recibimos {track}..."
                  style={{ borderColor: "var(--border)" }} 
                />
              </div>
              <button 
                onClick={handleSaveTemplate}
                disabled={savingTemplate || !templateForm.name}
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
                    onClick={() => setTemplateForm({ name: tpl.name, type: tpl.template_type, subject: tpl.subject_template, body: tpl.body_template })}
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
    <Suspense fallback={<div className="max-w-6xl mx-auto px-6 py-8"><div className="animate-pulse h-96 rounded" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }} /></div>}>
      <CRMContent />
    </Suspense>
  );
}
