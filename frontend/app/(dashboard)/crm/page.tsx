"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { cn } from "@/lib/utils";
import { usePlayer } from "@/lib/PlayerContext";

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

function buildTemplates(labelName: string): Template[] {
  return [
    {
      id: "reject-phase",
      label: "Rechazo — Problema de fase",
      subject: `Tu demo en ${labelName} — Feedback técnico`,
      body: `Hola {producer},\n\nGracias por enviar "{track}" a ${labelName}. Lo escuchamos y analizamos con nuestro motor técnico.\n\nLamentablemente, detectamos un problema de fase invertida en los canales L/R que afecta la compatibilidad mono del track. Esto es crítico para nosotros ya que nuestro material se reproduce en sistemas de club.\n\nTe sugerimos revisar la correlación de fase en tu master y volver a enviar.\n\nSaludos,\nEquipo A&R — ${labelName}`,
    },
    {
      id: "reject-tempo",
      label: "Rechazo — Fuera de tempo",
      subject: `Tu demo en ${labelName} — Feedback técnico`,
      body: `Hola {producer},\n\nGracias por enviar "{track}" a ${labelName}.\n\nTu track está en {bpm} BPM, mientras que nuestro rango aceptado es 120–128 BPM. Por eso no podemos considerarlo para nuestro catálogo actual.\n\nSi tenés material en el rango correcto, no dudes en enviarlo.\n\nSaludos,\nEquipo A&R — ${labelName}`,
    },
    {
      id: "approve",
      label: "Aprobación — Interés en el track",
      subject: `Tu demo fue aprobado en ${labelName}`,
      body: `Hola {producer},\n\nBuenas noticias: "{track}" pasó nuestro filtro técnico y nos encantó.\n\nQueremos avanzar a la siguiente fase de revisión artística. Nuestro equipo de A&R va a contactarte en los próximos días.\n\nSaludos,\nEquipo A&R — ${labelName}`,
    },
    {
      id: "followup",
      label: "Seguimiento — Segunda versión",
      subject: `Re: Tu demo corregido en ${labelName}`,
      body: `Hola {producer},\n\nRecibimos la versión corregida de "{track}". Estamos revisándola.\n\nTe avisamos en 48hs si pasa a la fase de escucha artística.\n\nGracias por la paciencia,\nEquipo A&R — ${labelName}`,
    },
  ];
}

function CRMContent() {
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
      const token = localStorage.getItem("token");
      const slug = localStorage.getItem("slug");
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      // Fetch label name
      if (slug) {
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/labels/${slug}`);
          if (res.ok) {
            const data = await res.json();
            setLabelName(data.name);
          }
        } catch {
          setLabelName(slug);
        }
      }

      // Fetch submissions
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/submissions`, { headers });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data: Submission[] = await res.json();

        // Filter to only non-pending (approved + rejected) for CRM contacts
        const resolved = data.filter((s) => s.status !== "pending");
        const mapped: Contact[] = resolved.map((s) => ({
          id: s.id,
          name: s.producer_name || "Anónimo",
          email: s.producer_email || "",
          track: s.track_name || "Sin nombre",
          status: s.status as "approved" | "rejected",
          bpm: s.bpm != null ? String(Math.round(s.bpm)) : "—",
          sent: false,
          mp3_path: s.mp3_path || null,
        }));
        setContacts(mapped);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error desconocido");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Auto-select and scroll to highlighted contact from inbox
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

  // Build templates with dynamic label name
  const templates = buildTemplates(labelName || "tu sello");

  const contact = contacts[selectedContact];
  const template = templates.find((t) => t.id === selectedTemplate);

  const resolveTemplate = (tpl: Template, c: Contact) => {
    return tpl.body
      .replace(/{producer}/g, c.name)
      .replace(/{track}/g, c.track)
      .replace(/{bpm}/g, c.bpm);
  };

  const handleTemplateChange = (id: string) => {
    setSelectedTemplate(id);
    const t = templates.find((t) => t.id === id)!;
    setEmailSubject(t.subject);
    if (contact) {
      setEmailBody(resolveTemplate(t, contact));
    } else {
      setEmailBody(t.body);
    }
    setSent(false);
  };

  const handleContactChange = (idx: number) => {
    setSelectedContact(idx);
    const t = templates.find((t) => t.id === selectedTemplate)!;
    const c = contacts[idx];
    if (c) {
      setEmailBody(resolveTemplate(t, c));
    } else {
      setEmailBody(t.body);
    }
    setSent(false);
  };

  // Initialize email body when templates and contacts are ready
  useEffect(() => {
    if (template && contacts.length > 0 && !emailBody) {
      setEmailSubject(template.subject);
      setEmailBody(resolveTemplate(template, contacts[0]));
    }
  }, [template, contacts, labelName]);

  const handleSendEmail = async () => {
    if (!contact) return;
    if (!contact.email) {
      setSendError("Este contacto no tiene email registrado. No se puede enviar el email.");
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/email/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: contact.email,
          subject: emailSubject,
          body: emailBody,
          from_name: labelName,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || `Error ${res.status}`);
      }
      setSent(true);
      setContacts((prev) => prev.map((c, i) => (i === selectedContact ? { ...c, sent: true } : c)));
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Error al enviar el email.");
    } finally {
      setSending(false);
    }
  };

  const rejectionCount = contacts.filter((c) => c.status === "rejected").length;
  const approvalCount = contacts.filter((c) => c.status === "approved").length;

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="font-display font-semibold text-xl mb-6">Emails</h1>
        <div className="rounded border overflow-hidden animate-pulse" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
          <div className="grid grid-cols-5" style={{ minHeight: "500px" }}>
            <div className="col-span-2 border-r" style={{ borderColor: "#27272a" }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: "#27272a" }}>
                <div className="h-3 w-24 rounded mb-2" style={{ background: "#1a1a1e" }} />
                <div className="flex gap-2">
                  <div className="h-4 w-16 rounded" style={{ background: "#1a1a1e" }} />
                  <div className="h-4 w-16 rounded" style={{ background: "#1a1a1e" }} />
                </div>
              </div>
              {[0, 1, 2].map((i) => (
                <div key={i} className="px-4 py-3 border-b" style={{ borderColor: "#1a1a1e" }}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="h-3 w-20 rounded" style={{ background: "#1a1a1e" }} />
                    <div className="h-3 w-14 rounded" style={{ background: "#1a1a1e" }} />
                  </div>
                  <div className="h-2 w-32 rounded" style={{ background: "#1a1a1e" }} />
                </div>
              ))}
            </div>
            <div className="col-span-3 p-4">
              <div className="h-3 w-16 rounded mb-3" style={{ background: "#1a1a1e" }} />
              <div className="h-8 w-full rounded mb-3" style={{ background: "#1a1a1e" }} />
              <div className="h-8 w-full rounded mb-3" style={{ background: "#1a1a1e" }} />
              <div className="h-40 w-full rounded" style={{ background: "#1a1a1e" }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="font-display font-semibold text-xl mb-6">Emails</h1>
        <div className="rounded border p-8 text-center" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
          <p className="text-sm" style={{ color: "#ef4444" }}>Error al cargar contactos: {error}</p>
          <button
            onClick={() => { setLoading(true); setError(null); }}
            className="mt-4 px-4 py-2 rounded text-sm font-medium"
            style={{ background: "#10b981", color: "#09090b" }}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
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
      <h1 className="font-display font-semibold text-xl mb-6">Emails</h1>

      <div className="rounded border overflow-hidden" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
        <div className="grid grid-cols-5" style={{ minHeight: "500px" }}>
          {/* Left Sidebar - Contacts */}
          <div className="col-span-2 border-r" style={{ borderColor: "#27272a" }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: "#27272a" }}>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">Contactos recientes</div>
              <div className="flex gap-2">
                <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
                  {rejectionCount} rechazos
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}>
                  {approvalCount} aprobados
                </span>
              </div>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: "450px" }}>
              {contacts.length > 0 ? contacts.map((c, i) => {
                const isHighlighted = highlightParam === c.id;
                return (
                <button
                  key={i}
                  id={`crm-contact-${c.id}`}
                  onClick={() => handleContactChange(i)}
                  className="w-full text-left px-4 py-3 border-b transition-all duration-500"
                  style={{
                    borderColor: "#1a1a1e",
                    background: isHighlighted
                      ? "rgba(16,185,129,0.08)"
                      : selectedContact === i
                        ? "rgba(16,185,129,0.04)"
                        : "transparent",
                    animation: isHighlighted ? "breathe 1.2s ease-in-out 1 forwards" : "none",
                    transition: "background 1.5s ease-out",
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate">{c.name}</span>
                    <span
                      className="font-mono text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ml-2"
                      style={{
                        background: c.status === "rejected" ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.15)",
                        color: c.status === "rejected" ? "#ef4444" : "#10b981",
                      }}
                    >
                      {c.status === "rejected" ? "Rechazado" : "Aprobado"}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted truncate">{c.email || "Sin email"}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {c.mp3_path && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (currentTrack?.id === c.id) {
                            togglePlay();
                          } else {
                            playTrack({ id: c.id, track_name: c.track, producer_name: c.name, mp3_path: c.mp3_path });
                          }
                        }}
                        className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 hover:bg-white/10 transition-colors"
                        title={currentTrack?.id === c.id && isPlaying ? "Pausar" : "Reproducir"}
                        style={{ color: currentTrack?.id === c.id ? "#10b981" : "#a1a1aa" }}
                      >
                        {currentTrack?.id === c.id && isPlaying ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                        )}
                      </button>
                    )}
                    <span className="text-[10px] text-muted">"{c.track}"</span>
                    <Link
                      href={`/inbox?highlight=${c.id}`}
                      className="text-[10px] hover:underline"
                      style={{ color: "#10b981" }}
                      onClick={(e) => e.stopPropagation()}
                      title="Ver demo"
                    >
                      Ver demo
                    </Link>
                    {c.sent && <span className="text-[10px]" style={{ color: "#10b981" }}>✓ Enviado</span>}
                    {!c.sent && <span className="text-[10px] text-muted">Pendiente</span>}
                  </div>
                </button>
              );}) : (
                <div className="py-12 text-center text-muted text-sm">
                  No hay contactos todavía. Las demos aprobadas o rechazadas aparecerán acá.
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Email Composer */}
          <div className="col-span-3 flex flex-col">
            {/* Template Selector */}
            <div className="px-4 py-3 border-b" style={{ borderColor: "#27272a" }}>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">Plantilla</div>
              <div className="flex gap-1.5 flex-wrap">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleTemplateChange(t.id)}
                    className="text-[10px] px-2.5 py-1 rounded border transition-colors"
                    style={{
                      borderColor: selectedTemplate === t.id ? "#10b981" : "#27272a",
                      color: selectedTemplate === t.id ? "#10b981" : "#71717a",
                      background: selectedTemplate === t.id ? "rgba(16,185,129,0.08)" : "transparent",
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Email Form */}
            <div className="flex-1 p-4 flex flex-col">
              <div className="mb-3">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1 block">Para</label>
                {contact ? (
                  <div className="text-sm font-medium">
                    {contact.name}{" "}
                    {contact.email ? (
                      <span className="text-muted">&lt;{contact.email}&gt;</span>
                    ) : (
                      <span className="text-muted">(sin email)</span>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-muted">Seleccioná un contacto</div>
                )}
              </div>

              <div className="mb-3">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1 block">Asunto</label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full px-3 py-2 rounded border text-sm bg-transparent"
                  style={{ borderColor: "#27272a" }}
                />
              </div>

              <div className="mb-4">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1 block">Cuerpo</label>
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className="w-full px-3 py-2 rounded border text-sm leading-relaxed bg-transparent resize-none"
                  style={{ borderColor: "#27272a", minHeight: "200px" }}
                  rows={8}
                />
              </div>

              <div className="flex items-center justify-between gap-3 mt-4">
                <div className="text-xs text-muted">
                  {sent ? (
                    <span style={{ color: "#10b981" }}>✓ Mail enviado a {contact?.name}</span>
                  ) : sendError ? (
                    <span style={{ color: "#ef4444" }}>{sendError}</span>
                  ) : (
                    <span>Variables auto-rellenadas: {"{producer}"}, {"{track}"}</span>
                  )}
                </div>
                <button
                  onClick={handleSendEmail}
                  disabled={sending}
                  className="px-5 py-2 rounded text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50"
                  style={{ background: sent ? "#27272a" : "#10b981", color: sent ? "#71717a" : "#09090b" }}
                >
                  {sending ? "Enviando..." : sent ? "Enviado" : "Enviar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CRMPage() {
  return (
    <Suspense fallback={<div className="max-w-6xl mx-auto px-6 py-8"><div className="animate-pulse h-96 rounded" style={{ background: "#0c0c0e", border: "1px solid #27272a" }} /></div>}>
      <CRMContent />
    </Suspense>
  );
}
