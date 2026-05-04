"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const CONTACTS = [
  { name: "DJ Krill", email: "djkrill@gmail.com", track: "Midnight", status: "rejected", sent: false },
  { name: "Anon", email: "anon.beats@proton.me", track: "Groove 03", status: "rejected", sent: true },
  { name: "Mara Beats", email: "mara@soundcloud.com", track: "Deep Cut", status: "approved", sent: false },
  { name: "Kael", email: "kael.music@gmail.com", track: "Drift", status: "approved", sent: true },
];

const TEMPLATES = [
  { id: "reject-phase", label: "Rechazo — Problema de fase", subject: "Tu demo en Nocturnal Records — Feedback técnico", body: "Hola {producer},\n\nGracias por enviar \"{track}\" a Nocturnal Records. Lo escuchamos y analizamos con nuestro motor técnico.\n\nLamentablemente, detectamos un problema de fase invertida en los canales L/R que afecta la compatibilidad mono del track. Esto es crítico para nosotros ya que nuestro material se reproduce en sistemas de club.\n\nTe sugerimos revisar la correlación de fase en tu master y volver a enviar.\n\nSaludos,\nEquipo A&R — Nocturnal Records" },
  { id: "reject-tempo", label: "Rechazo — Fuera de tempo", subject: "Tu demo en Nocturnal Records — Feedback técnico", body: "Hola {producer},\n\nGracias por enviar \"{track}\" a Nocturnal Records.\n\nTu track está en {bpm} BPM, mientras que nuestro rango aceptado es 120–128 BPM. Por eso no podemos considerarlo para nuestro catálogo actual.\n\nSi tenés material en el rango correcto, no dudes en enviarlo.\n\nSaludos,\nEquipo A&R — Nocturnal Records" },
  { id: "approve", label: "Aprobación — Interés en el track", subject: "Tu demo fue aprobado en Nocturnal Records", body: "Hola {producer},\n\nBuenas noticias: \"{track}\" pasó nuestro filtro técnico y nos encantó.\n\nQueremos avanzar a la siguiente fase de revisión artística. Nuestro equipo de A&R va a contactarte en los próximos días.\n\nSaludos,\nEquipo A&R — Nocturnal Records" },
  { id: "followup", label: "Seguimiento — Segunda versión", subject: "Re: Tu demo corregido en Nocturnal Records", body: "Hola {producer},\n\nRecibimos la versión corregida de \"{track}\". Estamos revisándola.\n\nTe avisamos en 48hs si pasa a la fase de escucha artística.\n\nGracias por la paciencia,\nEquipo A&R — Nocturnal Records" },
];

export default function CRMPage() {
  const [selectedTemplate, setSelectedTemplate] = useState("reject-phase");
  const [selectedContact, setSelectedContact] = useState(0);
  const [emailBody, setEmailBody] = useState(TEMPLATES[0].body);
  const [emailSubject, setEmailSubject] = useState(TEMPLATES[0].subject);
  const [sent, setSent] = useState(false);

  const contact = CONTACTS[selectedContact];
  const template = TEMPLATES.find((t) => t.id === selectedTemplate)!;

  const resolveTemplate = (tpl: typeof TEMPLATES[0], c: typeof CONTACTS[0]) => {
    return tpl.body.replace(/{producer}/g, c.name).replace(/{track}/g, c.track).replace(/{bpm}/g, "118");
  };

  const handleTemplateChange = (id: string) => {
    setSelectedTemplate(id);
    const t = TEMPLATES.find((t) => t.id === id)!;
    setEmailSubject(t.subject);
    setEmailBody(resolveTemplate(t, CONTACTS[selectedContact]));
    setSent(false);
  };

  const handleContactChange = (idx: number) => {
    setSelectedContact(idx);
    const t = TEMPLATES.find((t) => t.id === selectedTemplate)!;
    setEmailBody(resolveTemplate(t, CONTACTS[idx]));
    setSent(false);
  };

  const rejectionCount = CONTACTS.filter((c) => c.status === "rejected").length;
  const approvalCount = CONTACTS.filter((c) => c.status === "approved").length;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <h1 className="font-display font-semibold text-xl mb-6">CRM de Emails</h1>

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
              {CONTACTS.map((c, i) => (
                <button
                  key={i}
                  onClick={() => handleContactChange(i)}
                  className="w-full text-left px-4 py-3 border-b transition-colors"
                  style={{
                    borderColor: "#1a1a1e",
                    background: selectedContact === i ? "rgba(16,185,129,0.04)" : "transparent",
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
                  <div className="text-[10px] text-muted truncate">{c.email}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-muted">"{c.track}"</span>
                    {c.sent && <span className="text-[10px]" style={{ color: "#10b981" }}>✓ Enviado</span>}
                    {!c.sent && <span className="text-[10px] text-muted">Pendiente</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right Panel - Email Composer */}
          <div className="col-span-3 flex flex-col">
            {/* Template Selector */}
            <div className="px-4 py-3 border-b" style={{ borderColor: "#27272a" }}>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">Plantilla</div>
              <div className="flex gap-1.5 flex-wrap">
                {TEMPLATES.map((t) => (
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
                <div className="text-sm font-medium">{contact.name} &lt;{contact.email}&gt;</div>
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

              <div className="flex-1 mb-4">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1 block">Cuerpo</label>
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className="w-full h-full min-h-[200px] px-3 py-2 rounded border text-sm leading-relaxed bg-transparent resize-none"
                  style={{ borderColor: "#27272a" }}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="text-xs text-muted">
                  {sent ? (
                    <span style={{ color: "#10b981" }}>✓ Mail enviado a {contact.name}</span>
                  ) : (
                    <span>Variables auto-rellenadas: {"{producer}"}, {"{track}"}</span>
                  )}
                </div>
                <button
                  onClick={() => setSent(true)}
                  className="px-5 py-2 rounded text-sm font-medium transition-all hover:opacity-90"
                  style={{ background: sent ? "#27272a" : "#10b981", color: sent ? "#71717a" : "#09090b" }}
                >
                  {sent ? "Enviado" : "Enviar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
