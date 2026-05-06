"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import WhatsAppBubble from "@/components/WhatsAppBubble";

// ─── Demo Simulation Component ───────────────────────────────────────────────

function DemoSimulation() {
  const [trackState, setTrackState] = useState<"analyzing" | "error" | "approved">("analyzing");
  const [trackName, setTrackName] = useState("");
  const [detectedIssue, setDetectedIssue] = useState("");
  const [metrics, setMetrics] = useState({ bpm: "---", lufs: "---", phase: "---" });
  const [bars, setBars] = useState(Array(24).fill(10));
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState(0);

  const tracks = [
    { name: "DJ_Krill_—_Midnight.wav", issue: "Fase invertida en L/R", bpm: "128", lufs: "-6.2", phase: "INVERTIDA", state: "error" as const },
    { name: "ProducerX_—_Sunrise.wav", issue: "LUFS excesivo", bpm: "140", lufs: "-4.1", phase: "OK", state: "error" as const },
    { name: "Anon_—_Groove_03.wav", issue: "Fuera de tempo (118 vs 124)", bpm: "118", lufs: "-14.3", phase: "OK", state: "error" as const },
    { name: "Mara_—_Deep_Cut.wav", issue: null, bpm: "122", lufs: "-14.0", phase: "OK", state: "approved" as const },
    { name: "Subsonic_—_Pulse.wav", issue: null, bpm: "126", lufs: "-12.8", phase: "OK", state: "approved" as const },
  ];
  const [trackIdx, setTrackIdx] = useState(0);

  useEffect(() => {
    const cycle = () => {
      const track = tracks[trackIdx];
      setTrackName(track.name);
      setTrackState("analyzing");
      setProgress(0);
      setDetectedIssue("");
      setMetrics({ bpm: "---", lufs: "---", phase: "---" });

      setTimeout(() => {
        setMetrics({ bpm: track.bpm, lufs: track.lufs, phase: track.phase });
        setProgress(60);
      }, 800);

      setTimeout(() => {
        setProgress(100);
        if (track.state === "error") {
          setTrackState("error");
          setDetectedIssue(track.issue || "");
        } else {
          setTrackState("approved");
        }
      }, 2200);

      setTimeout(() => {
        setTrackIdx((prev) => (prev + 1) % tracks.length);
      }, 4500);
    };

    cycle();
    const intervalRef = setInterval(cycle, 5000);
    return () => clearInterval(intervalRef);
  }, [trackIdx]);

  useEffect(() => {
    const interval = setInterval(() => {
      setBars((prev) =>
        prev.map(() => {
          if (trackState === "error") return Math.random() * 20 + 5;
          if (trackState === "approved") return Math.random() * 60 + 30;
          return Math.random() * 40 + 10;
        })
      );
    }, 150);
    return () => clearInterval(interval);
  }, [trackState]);

  useEffect(() => {
    const interval = setInterval(() => {
      const newNotes = new Set<number>();
      const count = trackState === "analyzing" ? 6 : trackState === "error" ? 2 : 8;
      while (newNotes.size < count) {
        newNotes.add(Math.floor(Math.random() * 48));
      }
      setActiveNotes(newNotes);
    }, 400);
    return () => clearInterval(interval);
  }, [trackState]);

  const stateColor = trackState === "error" ? "#ef4444" : trackState === "approved" ? "#10b981" : "#06b6d4";
  const stateLabel = trackState === "error" ? "RECHAZADO" : trackState === "approved" ? "APROBADO" : "ANALIZANDO";

  return (
    <div className="rounded border overflow-hidden" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "#27272a" }}>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: stateColor }} />
          <span className="font-mono text-xs" style={{ color: stateColor }}>{stateLabel}</span>
        </div>
        <span className="font-mono text-xs text-muted truncate max-w-[200px]">{trackName}</span>
      </div>

      <div className="relative p-3">
        <div className="grid grid-cols-12 gap-[2px] mb-3">
          {Array.from({ length: 48 }).map((_, i) => (
            <div
              key={i}
              className="transition-all duration-300"
              style={{
                height: "4px",
                background: activeNotes.has(i) ? stateColor : "#1a1a1e",
                opacity: activeNotes.has(i) ? 0.8 : 0.2,
              }}
            />
          ))}
        </div>

        <div className="flex items-end gap-[2px] h-14 mb-3 px-1">
          {bars.map((h, i) => (
            <div
              key={i}
              className="flex-1"
              style={{
                height: `${h}%`,
                background: stateColor,
                opacity: 0.6,
                transition: "height 0.15s ease",
              }}
            />
          ))}
        </div>

        {trackState === "analyzing" && (
          <div className="absolute left-0 right-0 h-[1px]" style={{
            background: "linear-gradient(90deg, transparent, rgba(16,185,129,0.4), transparent)",
            animation: "scan-line 3s linear infinite",
          }} />
        )}
      </div>

      <div className="grid grid-cols-3 gap-px" style={{ background: "#27272a" }}>
        {[
          { label: "BPM", value: metrics.bpm },
          { label: "LUFS", value: metrics.lufs },
          { label: "FASE", value: metrics.phase },
        ].map((m) => (
          <div key={m.label} className="px-3 py-2 text-center" style={{ background: "#111114" }}>
            <div className="text-[10px] uppercase tracking-wider text-muted font-mono">{m.label}</div>
            <div className="font-mono text-sm" style={{ color: m.value === "INVERTIDA" ? "#ef4444" : m.value === "---" ? "#52525b" : "#fafafa" }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {detectedIssue && (
        <div className="px-4 py-2 border-t flex items-center gap-2" style={{ borderColor: "#27272a" }}>
          <span className="font-mono text-xs text-red">{detectedIssue}</span>
        </div>
      )}
      {trackState === "approved" && (
        <div className="px-4 py-2 border-t flex items-center gap-2" style={{ borderColor: "#27272a" }}>
          <span className="font-mono text-xs" style={{ color: "#10b981" }}>122 BPM, Mezcla OK, Fase correcta</span>
        </div>
      )}

      <div className="h-px w-full" style={{ background: "#1a1a1e" }}>
        <div className="h-full transition-all duration-500 ease-out" style={{ width: `${progress}%`, background: stateColor }} />
      </div>
    </div>
  );
}

// ─── Feature Card ─────────────────────────────────────────────────────────────

function FeatureCard({ num, title, desc }: { num: string; title: string; desc: string }) {
  return (
    <div className="border-b pb-8" style={{ borderColor: "#27272a" }}>
      <div className="font-mono text-xs text-muted mb-3">{num}</div>
      <h3 className="font-display font-semibold text-base mb-2">{title}</h3>
      <p className="text-sm text-muted leading-relaxed">{desc}</p>
    </div>
  );
}

// ─── Pricing Card ─────────────────────────────────────────────────────────────

function PricingCard({ name, price, features, highlighted, href }: { name: string; price: string; features: string[]; highlighted?: boolean; href?: string }) {
  return (
    <div className="border p-6" style={{ borderColor: highlighted ? "#10b981" : "#27272a" }}>
      <div className="flex items-baseline justify-between mb-6">
        <div className="text-xs font-mono uppercase tracking-wider text-muted">{name}</div>
        <div className="flex items-baseline gap-1">
          <span className="font-display font-bold text-3xl">US${price}</span>
          <span className="text-muted text-xs">/mes</span>
        </div>
      </div>
      <ul className="space-y-2 mb-8">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span style={{ color: "#10b981" }}>·</span>
            <span className="text-muted">{f}</span>
          </li>
        ))}
      </ul>
      <a
        href={href}
        target={href?.startsWith("http") ? "_blank" : undefined}
        className="w-full py-2.5 text-sm font-medium transition-all hover:opacity-90 rounded block text-center"
        style={{
          background: highlighted ? "#10b981" : "transparent",
          color: highlighted ? "#09090b" : "#fafafa",
          border: highlighted ? "none" : "1px solid #27272a",
        }}
      >
        {highlighted ? "Empezar ahora" : "Crear cuenta"}
      </a>
    </div>
  );
}

// ─── Dashboard Mockup ─────────────────────────────────────────────────────────

function DashboardMockup({ mode }: { mode: "config" | "link" | "inbox" | "emailCRM" }) {
  const demos = [
    { name: "Mara — Deep Cut", producer: "Mara Beats", bpm: "122", lufs: "-14.0", phase: "OK", key: "Am", status: "pending", time: "Hace 3 min" },
    { name: "Subsonic — Pulse", producer: "Subsonic", bpm: "126", lufs: "-12.8", phase: "OK", key: "Fm", status: "pending", time: "Hace 12 min" },
    { name: "DJ Krill — Midnight", producer: "DJ Krill", bpm: "128", lufs: "-6.2", phase: "INV", key: "Cm", status: "rejected", time: "Hace 18 min", issue: "Fase + LUFS" },
    { name: "Anon — Groove 03", producer: "Anon", bpm: "118", lufs: "-14.3", phase: "OK", key: "Dm", status: "rejected", time: "Hace 24 min", issue: "Fuera de tempo" },
    { name: "Kael — Drift", producer: "Kael", bpm: "124", lufs: "-13.5", phase: "OK", key: "Em", status: "approved", time: "Ayer" },
    { name: "Vex — Hollow", producer: "Vex", bpm: "123", lufs: "-13.8", phase: "OK", key: "Bbm", status: "approved", time: "Ayer" },
  ];

  const emailContacts = [
    { name: "DJ Krill", email: "djkrill@gmail.com", track: "Midnight", status: "rejected", reason: "Fase invertida + LUFS > -8", sent: false },
    { name: "Anon", email: "anon.beats@proton.me", track: "Groove 03", status: "rejected", reason: "Fuera de tempo", sent: true },
    { name: "Mara Beats", email: "mara@soundcloud.com", track: "Deep Cut", status: "approved", reason: null, sent: false },
    { name: "Kael", email: "kael.music@gmail.com", track: "Drift", status: "approved", reason: null, sent: true },
  ];

  const templates = [
    { id: "reject-phase", label: "Rechazo — Problema de fase", type: "rejection",
      subject: "Tu demo en Tu Sello — Feedback técnico",
      body: "Hola {producer},\n\nGracias por enviar \"{track}\" a Tu Sello. Lo escuchamos y analizamos con nuestro motor técnico.\n\nLamentablemente, detectamos un problema de fase invertida en los canales L/R que afecta la compatibilidad mono del track. Esto es crítico para nosotros ya que nuestro material se reproduce en sistemas de club.\n\nTe sugerimos revisar la correlación de fase en tu master y volver a enviar. Estamos abiertos a recibir una versión corregida.\n\nSaludos,\nEquipo A&R — Tu Sello" },
    { id: "reject-tempo", label: "Rechazo — Fuera de tempo", type: "rejection",
      subject: "Tu demo en Tu Sello — Feedback técnico",
      body: "Hola {producer},\n\nGracias por enviar \"{track}\" a Tu Sello.\n\nTu track está en {bpm} BPM, mientras que nuestro rango aceptado es 120–128 BPM. Por eso no podemos considerarlo para nuestro catálogo actual.\n\nSi tenés material en el rango correcto, no dudes en enviarlo. Valoramos tu trabajo.\n\nSaludos,\nEquipo A&R — Tu Sello" },
    { id: "approve", label: "Aprobación — Interés en el track", type: "approval",
      subject: "Tu demo fue aprobado en Tu Sello",
      body: "Hola {producer},\n\nBuenas noticias: \"{track}\" pasó nuestro filtro técnico y nos encantó.\n\nQueremos avanzar a la siguiente fase de revisión artística. Nuestro equipo de A&R va a contactarte en los próximos días para coordinar próximos pasos.\n\nMientras tanto, si tenés más material en el mismo estilo, envialo por tu link de True Peak AI.\n\nSaludos,\nEquipo A&R — Tu Sello" },
    { id: "followup", label: "Seguimiento — Segunda versión", type: "followup",
      subject: "Re: Tu demo corregido en Tu Sello",
      body: "Hola {producer},\n\nRecibimos la versión corregida de \"{track}\". Estamos revisándola.\n\nTe avisamos en 48hs si pasa a la fase de escucha artística.\n\nGracias por la paciencia,\nEquipo A&R — Tu Sello" },
  ];

  if (mode === "config") {
    return (
      <div className="rounded border overflow-hidden" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "#27272a" }}>
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: "#10b981" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#09090b" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            <span className="font-display font-semibold text-xs">True Peak AI</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted">
            <span style={{ color: "#fafafa" }}>Firma sónica</span>
            <span>Link</span>
            <span>Demos</span>
          </div>
          <div className="w-6 h-6 rounded-full" style={{ background: "#27272a" }} />
        </div>

        <div className="p-6">
          <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Configuración</div>
          <h3 className="font-display font-semibold text-lg mb-6">Firma sónica — Sello principal</h3>

          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Rango de BPM</label>
                <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: "#18181b" }}>120 — 128</span>
              </div>
              <div className="h-1.5 rounded-full" style={{ background: "#27272a" }}>
                <div className="h-full rounded-full" style={{ width: "40%", marginLeft: "25%", background: "#10b981" }} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">LUFS objetivo</label>
                <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: "#18181b" }}>-14 ± 2</span>
              </div>
              <div className="h-1.5 rounded-full" style={{ background: "#27272a" }}>
                <div className="h-full rounded-full" style={{ width: "30%", marginLeft: "35%", background: "#10b981" }} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Escala preferida</label>
                <div className="flex gap-1.5">
                  {["Menor", "Mayor", "Dórica", "Frigia"].map((s, i) => (
                    <span key={s} className="text-xs px-2 py-1 rounded border"
                          style={{ borderColor: i === 0 ? "#10b981" : "#27272a", color: i === 0 ? "#10b981" : "#71717a", background: i === 0 ? "rgba(16,185,129,0.1)" : "transparent" }}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Rechazo automático</label>
                <div className="space-y-1.5">
                  {["Fase invertida", "LUFS > -8", "Fuera de tempo"].map((r) => (
                    <div key={r} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm flex items-center justify-center" style={{ background: "#10b981" }}>
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#09090b" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                      <span className="text-xs text-muted">{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t" style={{ borderColor: "#27272a" }}>
              <button className="px-4 py-2 text-xs font-medium rounded" style={{ background: "#10b981", color: "#09090b" }}>
                Guardar firma sónica
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "link") {
    return (
      <div className="rounded border overflow-hidden" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "#27272a" }}>
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: "#10b981" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#09090b" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            <span className="font-display font-semibold text-xs">True Peak AI</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted">
            <span>Firma sónica</span>
            <span style={{ color: "#fafafa" }}>Link</span>
            <span>Demos</span>
          </div>
          <div className="w-6 h-6 rounded-full" style={{ background: "#27272a" }} />
        </div>

        <div className="p-6">
          <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Tu link de recepción</div>
          <h3 className="font-display font-semibold text-lg mb-4">Compartí este link con productores</h3>

          <div className="flex items-center gap-2 mb-4">
            <div className="flex-1 px-3 py-2.5 rounded border font-mono text-sm" style={{ borderColor: "#27272a", background: "#111114" }}>
              tudominio.com/s/tu-sello
            </div>
            <button className="px-3 py-2.5 rounded text-xs font-medium" style={{ background: "#10b981", color: "#09090b" }}>
              Copiar
            </button>
          </div>

          <div className="text-xs text-muted mb-4">
            Los productores que entren por este link verán tu nombre de sello, tus requisitos técnicos y un formulario simple para subir su WAV.
          </div>

          <div className="rounded border p-4" style={{ borderColor: "#27272a", background: "#111114" }}>
            <div className="text-xs font-mono text-muted mb-2">Vista previa del link</div>
            <div className="rounded border p-3" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-4 h-4 rounded" style={{ background: "#10b981" }} />
                <span className="font-display font-semibold text-xs">Tu Sello</span>
              </div>
              <div className="text-xs text-muted mb-3">Subí tu demo. Analizamos BPM, LUFS, fase y headroom antes de que el sello lo escuche.</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-8 rounded border flex items-center px-2" style={{ borderColor: "#27272a" }}>
                  <span className="text-xs text-muted">Elegí tu archivo .wav…</span>
                </div>
                <button className="px-3 h-8 rounded text-xs font-medium" style={{ background: "#10b981", color: "#09090b" }}>Enviar</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "inbox") {
    return (
      <div className="rounded border overflow-hidden" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "#27272a" }}>
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: "#10b981" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#09090b" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            <span className="font-display font-semibold text-xs">True Peak AI</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted">
            <span>Firma sónica</span>
            <span>Link</span>
            <span style={{ color: "#fafafa" }}>Demos</span>
          </div>
          <div className="w-6 h-6 rounded-full" style={{ background: "#27272a" }} />
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h3 className="font-display font-semibold text-sm">Bandeja de demos</h3>
              <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}>2 nuevos</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span style={{ color: "#fafafa" }}>Todos</span>
              <span>Pendientes</span>
              <span>Aprobados</span>
              <span>Rechazados</span>
            </div>
          </div>

          <div className="space-y-px">
            <div className="grid grid-cols-12 gap-2 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-muted" style={{ borderBottom: "1px solid #27272a" }}>
              <div className="col-span-4">Track</div>
              <div className="col-span-1 text-center">BPM</div>
              <div className="col-span-1 text-center">LUFS</div>
              <div className="col-span-1 text-center">Fase</div>
              <div className="col-span-1 text-center">Escala</div>
              <div className="col-span-2 text-center">Estado</div>
              <div className="col-span-2 text-right">Acción</div>
            </div>

            {demos.map((d, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 px-3 py-2.5 text-xs items-center hover:bg-surface transition-colors"
                   style={{ background: d.status === "pending" ? "rgba(6,182,212,0.04)" : "transparent", borderBottom: "1px solid #1a1a1e" }}>
                <div className="col-span-4">
                  <div className="font-medium truncate">{d.name}</div>
                  <div className="text-[10px] text-muted">{d.producer} · {d.time}</div>
                </div>
                <div className="col-span-1 text-center font-mono">{d.bpm}</div>
                <div className="col-span-1 text-center font-mono">{d.lufs}</div>
                <div className="col-span-1 text-center font-mono" style={{ color: d.phase === "INV" ? "#ef4444" : "#10b981" }}>{d.phase}</div>
                <div className="col-span-1 text-center font-mono text-muted">{d.key}</div>
                <div className="col-span-2 text-center">
                  {d.status === "pending" && <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(6,182,212,0.15)", color: "#06b6d4" }}>Pendiente</span>}
                  {d.status === "approved" && <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}>Aprobado</span>}
                  {d.status === "rejected" && <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>Rechazado</span>}
                </div>
                <div className="col-span-2 text-right">
                  {d.status === "pending" && (
                    <div className="flex items-center justify-end gap-1">
                      <button className="px-2 py-1 rounded text-[10px] font-medium" style={{ background: "#10b981", color: "#09090b" }}>Escuchar</button>
                      <button className="px-2 py-1 rounded text-[10px] border" style={{ borderColor: "#27272a", color: "#71717a" }}>Descartar</button>
                    </div>
                  )}
                  {d.status === "rejected" && (
                    <span className="text-[10px] text-muted">{d.issue}</span>
                  )}
                  {d.status === "approved" && (
                    <span className="text-[10px] text-muted">En cola</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (mode === "emailCRM") {
    const [selectedTemplate, setSelectedTemplate] = useState("reject-phase");
    const [selectedContact, setSelectedContact] = useState(0);
    const [emailBody, setEmailBody] = useState(templates[0].body);
    const [emailSubject, setEmailSubject] = useState(templates[0].subject);
    const [sent, setSent] = useState(false);

    const contact = emailContacts[selectedContact];
    const template = templates.find(t => t.id === selectedTemplate);

    const resolveTemplate = (tpl: typeof templates[0], c: typeof emailContacts[0]) => {
      return tpl.body
        .replace(/{producer}/g, c.name)
        .replace(/{track}/g, c.track)
        .replace(/{bpm}/g, "118");
    };

    const handleTemplateChange = (id: string) => {
      setSelectedTemplate(id);
      const t = templates.find(t => t.id === id)!;
      setEmailSubject(t.subject);
      setEmailBody(resolveTemplate(t, emailContacts[selectedContact]));
      setSent(false);
    };

    const handleContactChange = (idx: number) => {
      setSelectedContact(idx);
      const t = templates.find(t => t.id === selectedTemplate)!;
      setEmailBody(resolveTemplate(t, emailContacts[idx]));
      setSent(false);
    };

    return (
      <div className="rounded border overflow-hidden" style={{ borderColor: "#27272a", background: "#0c0c0e" }}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "#27272a" }}>
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: "#10b981" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#09090b" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            <span className="font-display font-semibold text-xs">True Peak AI</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted">
            <span>Firma sónica</span>
            <span>Link</span>
            <span>Demos</span>
            <span style={{ color: "#fafafa" }}>CRM</span>
          </div>
          <div className="w-6 h-6 rounded-full" style={{ background: "#27272a" }} />
        </div>

        <div className="grid grid-cols-5" style={{ minHeight: "400px" }}>
          <div className="col-span-2 border-r" style={{ borderColor: "#27272a" }}>
            <div className="px-3 py-2 border-b" style={{ borderColor: "#27272a" }}>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">Contactos recientes</div>
              <div className="flex gap-1 mb-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>2 rechazos</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}>2 aprobados</span>
              </div>
            </div>
            <div className="overflow-y-auto">
              {emailContacts.map((c, i) => (
                <button
                  key={i}
                  onClick={() => handleContactChange(i)}
                  className="w-full text-left px-3 py-2.5 border-b transition-colors hover:bg-surface"
                  style={{ borderColor: "#1a1a1e", background: selectedContact === i ? "rgba(16,185,129,0.04)" : "transparent" }}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium truncate">{c.name}</span>
                    <span className="font-mono text-[10px] px-1 rounded flex-shrink-0 ml-2"
                          style={{
                            background: c.status === "rejected" ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.15)",
                            color: c.status === "rejected" ? "#ef4444" : "#10b981",
                          }}>
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

          <div className="col-span-3 flex flex-col">
            <div className="px-4 py-2.5 border-b" style={{ borderColor: "#27272a" }}>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted mb-2">Plantilla</div>
              <div className="flex gap-1.5 flex-wrap">
                {templates.map(t => (
                  <button
                    key={t.id}
                    onClick={() => handleTemplateChange(t.id)}
                    className="text-[10px] px-2 py-1 rounded border transition-colors"
                    style={{
                      borderColor: selectedTemplate === t.id ? "#10b981" : "#27272a",
                      color: selectedTemplate === t.id ? "#10b981" : "#71717a",
                      background: selectedTemplate === t.id ? "rgba(16,185,129,0.08)" : "transparent",
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 p-4 flex flex-col">
              <div className="mb-3">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1 block">Para</label>
                <div className="text-xs font-medium">{contact.name} &lt;{contact.email}&gt;</div>
              </div>

              <div className="mb-3">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1 block">Asunto</label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border text-xs bg-transparent"
                  style={{ borderColor: "#27272a" }}
                />
              </div>

              <div className="flex-1 mb-3">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1 block">Cuerpo</label>
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className="w-full h-full min-h-[160px] px-3 py-2 rounded border text-xs leading-relaxed bg-transparent resize-none font-body"
                  style={{ borderColor: "#27272a" }}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="text-[10px] text-muted">
                  {sent ? (
                    <span style={{ color: "#10b981" }}>✓ Mail enviado a {contact.name}</span>
                  ) : (
                    <span>Variables auto-rellenadas: {"{producer}"}, {"{track}"}</span>
                  )}
                </div>
                <button
                  onClick={() => setSent(true)}
                  className="px-4 py-1.5 rounded text-xs font-medium transition-all hover:opacity-90"
                  style={{ background: sent ? "#27272a" : "#10b981", color: sent ? "#71717a" : "#09090b" }}>
                  {sent ? "Enviado" : "Enviar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Workflow Section ─────────────────────────────────────────────────────────

function WorkflowSection() {
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    {
      num: "01",
      label: "Configurá tu firma sónica",
      desc: "Definí los BPM que buscás, el rango de LUFS aceptable, la escala musical y qué problemas te hacen rechazar un demo automáticamente. Una sola vez.",
      mode: "config" as const,
    },
    {
      num: "02",
      label: "Copiá tu link y pegalo en tu IG",
      desc: "Tu link único (tudominio.com/s/tu-sello) va en tu bio de Instagram, tu web, o donde sea. Los productores entran, ven tus requisitos y suben su WAV sin registro.",
      mode: "link" as const,
    },
    {
      num: "03",
      label: "El productor manda el tema",
      desc: "Sube el WAV. Nuestro motor lo analiza en segundos: BPM, LUFS, fase, headroom, detección de samples. Si no cumple tus reglas, se rechaza solo con feedback educado.",
      mode: "config" as const,
    },
    {
      num: "04",
      label: "Recibí los demos filtrados en tu dashboard",
      desc: "Tu bandeja muestra solo lo que pasó el filtro. Escuchá, aprobá o descartá. Los rechazados ya tienen el motivo claro. Vos solo decidís sobre lo que vale la pena.",
      mode: "inbox" as const,
    },
    {
      num: "05",
      label: "Gestioná todo desde tu CRM de emails",
      desc: "Mini CRM integrado: ves quién fue aprobado y quién rechazado, elegís una plantilla pre-armada (rechazo por fase, por tempo, aprobación, seguimiento), editás el cuerpo si querés, y mandás el mail en un clic. Variables como {producer} y {track} se rellenan solas.",
      mode: "emailCRM" as const,
    },
  ];

  return (
    <section id="workflow" className="py-16 px-6" style={{ borderTop: "1px solid #27272a" }}>
      <div className="max-w-6xl mx-auto">
        <div className="mb-12">
          <div className="text-xs font-mono uppercase tracking-wider text-muted mb-3">Workflow</div>
          <h2 className="font-display font-bold text-2xl md:text-3xl tracking-tight">
            Así trabaja tu sello <span style={{ color: "#10b981" }}>con True Peak AI</span>
          </h2>
          <p className="text-sm text-muted mt-3 max-w-lg">
            De la configuración al primer mail enviado en menos de 5 minutos. Sin emails, sin Drive, sin caos.
          </p>
        </div>

        <div className="grid lg:grid-cols-5 gap-8 lg:gap-12">
          <div className="lg:col-span-2">
            <div className="space-y-0">
              {steps.map((step, i) => (
                <button
                  key={step.num}
                  onClick={() => setActiveStep(i)}
                  className="w-full text-left p-4 rounded border transition-all duration-200"
                  style={{
                    borderColor: activeStep === i ? "#10b981" : "#27272a",
                    background: activeStep === i ? "rgba(16,185,129,0.04)" : "transparent",
                    marginBottom: i < steps.length - 1 ? "1px" : "0",
                  }}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-mono text-xs" style={{ color: activeStep === i ? "#10b981" : "#52525b" }}>{step.num}</span>
                    <h3 className="font-display font-semibold text-sm" style={{ color: activeStep === i ? "#fafafa" : "#71717a" }}>{step.label}</h3>
                  </div>
                  {activeStep === i && (
                    <p className="text-xs text-muted leading-relaxed pl-6">{step.desc}</p>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-3">
            <DashboardMockup mode={steps[activeStep].mode} />
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Nav ──────────────────────────────────────────────────────────────────────

function Nav() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
         style={{ background: scrolled ? "rgba(9,9,11,0.95)" : "transparent", backdropFilter: scrolled ? "blur(12px)" : "none", borderBottom: scrolled ? "1px solid #27272a" : "1px solid transparent", paddingTop: "12px", paddingBottom: "12px" }}>
      <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
        <button onClick={() => router.push("/")}>
          <img src="/logo.png" alt="True Peak AI" className="h-8 w-auto" />
        </button>
        <div className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-sm text-muted hover:text-fg transition-colors">Funcionalidades</a>
          <a href="#workflow" className="text-sm text-muted hover:text-fg transition-colors">Workflow</a>
          <a href="#pricing" className="text-sm text-muted hover:text-fg transition-colors">Precios</a>
        </div>
        <button
          onClick={() => router.push("/login")}
          className="px-4 py-1.5 text-sm font-medium transition-all hover:opacity-90 rounded"
          style={{ background: "#10b981", color: "#09090b" }}
        >
          Acceso Sellos
        </button>
      </div>
    </nav>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const router = useRouter();

  return (
    <div className="min-h-screen">
      <style jsx global>{`
        @keyframes bar-bounce {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1); }
        }
        @keyframes scan-line {
          0% { top: 0; }
          100% { top: 100%; }
        }
      `}</style>

      <Nav />

      {/* Hero */}
      <section className="pt-36 pb-16 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <h1 className="font-display font-bold text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight mb-6">
                Dejá de escuchar demos malos.<br />
                <span style={{ color: "#10b981" }}>Automatizá tu A&R.</span>
              </h1>
              <p className="text-base text-muted leading-relaxed mb-8 max-w-md">
                El primer filtro de demos con análisis técnico por IA. Seteá la firma sónica de tu sello y dejá que nuestro motor descarte los tracks fuera de tempo, mal mezclados o con problemas de fase antes de que lleguen a tus oídos.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
              onClick={() => router.push("https://truepeak.lemonsqueezy.com/checkout/buy/60230548-372d-421b-8b00-f15a78817c76")}
                  className="px-5 py-2.5 text-sm font-medium transition-all hover:opacity-90 rounded"
                  style={{ background: "#10b981", color: "#09090b" }}
                >
                  Crear cuenta (Prueba Gratis)
                </button>
                <button
                  onClick={() => document.getElementById("workflow")?.scrollIntoView({ behavior: "smooth" })}
                  className="px-5 py-2.5 text-sm transition-all hover:bg-surface2 rounded"
                  style={{ border: "1px solid #27272a", color: "#fafafa" }}
                >
                  Ver demo en vivo
                </button>
              </div>
            </div>

            <div className="w-full max-w-md">
              <DemoSimulation />
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-16 px-6" style={{ borderTop: "1px solid #27272a" }}>
        <div className="max-w-6xl mx-auto">
          <div className="mb-12">
            <div className="text-xs font-mono uppercase tracking-wider text-muted mb-3">Funcionalidades</div>
            <h2 className="font-display font-bold text-2xl md:text-3xl tracking-tight">
              Todo lo que tu oído necesita, <span style={{ color: "#10b981" }}>nada que no</span>
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-0">
            <FeatureCard
              num="01"
              title="Firma Sónica Personalizada"
              desc="Definí tus BPM, escala musical y tolerancia de LUFS. Cada sello tiene su sonido — True Peak AI lo aprende y lo aplica a cada demo que recibe."
            />
            <FeatureCard
              num="02"
              title="Cero Fricción para el Productor"
              desc="Ellos suben el WAV, nosotros lo convertimos a un stream ultraliviano para tu dashboard. Sin registros eternos, sin archivos pesados."
            />
            <FeatureCard
              num="03"
              title="Rechazos Automáticos"
              desc="Feedback instantáneo y educado para los demos que no cumplen tu estándar. El productor sabe qué mejorar, y vos no perdés tiempo."
            />
          </div>
        </div>
      </section>

      {/* Workflow */}
      <WorkflowSection />

      {/* Pricing */}
      <section id="pricing" className="py-16 px-6" style={{ borderTop: "1px solid #27272a" }}>
        <div className="max-w-3xl mx-auto">
          <div className="mb-12">
            <div className="text-xs font-mono uppercase tracking-wider text-muted mb-3">Precios</div>
            <h2 className="font-display font-bold text-2xl md:text-3xl tracking-tight">
              Simple. <span style={{ color: "#10b981" }}>Sin sorpresas.</span>
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <PricingCard
              name="Boutique"
              price="29"
              href="https://truepeak.lemonsqueezy.com/checkout/buy/60230548-372d-421b-8b00-f15a78817c76"
              features={[
                "Hasta 50 demos/mes",
                "1 firma sónica personalizada",
                "Análisis técnico completo",
                "Dashboard básico",
                "CRM de emails con plantillas",
                "Feedback automático para rechazos",
              ]}
            />
            <PricingCard
              name="Label Pro"
              price="79"
              highlighted
              href="https://truepeak.lemonsqueezy.com/checkout/buy/60230548-372d-421b-8b00-f15a78817c76"
              features={[
                "Demos ilimitados",
                "Hasta 5 firmas sónicas",
                "Análisis avanzado + detección de samples",
                "Dashboard completo + export CSV",
                "CRM avanzado + plantillas custom",
                "API para integrar con tu DAW",
                "Soporte prioritario",
              ]}
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6" style={{ borderTop: "1px solid #27272a" }}>
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <img src="/logo.png" alt="True Peak AI" className="h-10 w-auto" />
          <div className="text-xs text-muted">
            &copy; 2026 True Peak AI. Hecho con cabeza en Buenos Aires.
          </div>
          <div className="flex items-center gap-6 text-xs text-muted">
            <a href="/terms-of-service" className="hover:text-fg transition-colors">Términos</a>
            <a href="/privacy-policy" className="hover:text-fg transition-colors">Privacidad</a>
            <a href="/refund-policy" className="hover:text-fg transition-colors">Reembolsos</a>
          </div>
        </div>
      </footer>

      {/* Feedback Bubble */}
      <FeedbackBubble />
    </div>
  );
}

// ─── Feedback Bubble ─────────────────────────────────────────────────────────

function FeedbackBubble() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setIsLoggedIn(!!localStorage.getItem("token"));
  }, []);

  const sendToWhatsApp = () => {
    if (!message.trim()) return;
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/5491135167226?text=${encoded}`, "_blank");
    setMessage("");
    setIsOpen(false);
  };

  if (!isLoggedIn) return null;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Bubble button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110"
        style={{ background: "#10b981", color: "#09090b", boxShadow: "0 4px 20px rgba(16,185,129,0.3)" }}
        aria-label="Enviar feedback"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {/* Popup */}
      {isOpen && (
        <div
          className="fixed bottom-20 right-6 z-50 w-80 rounded-lg border p-4"
          style={{ background: "#111114", borderColor: "#27272a", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="font-display font-semibold text-sm">Feedback</span>
            <button onClick={() => setIsOpen(false)} className="text-muted hover:text-foreground transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          <p className="text-xs text-muted mb-3">Bugs, sugerencias o lo que sea. Me llega directo a WhatsApp.</p>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Contame qué pasó..."
            className="w-full h-24 px-3 py-2 rounded border text-xs bg-transparent resize-none mb-3"
            style={{ borderColor: "#27272a" }}
          />
          <button
            onClick={sendToWhatsApp}
            disabled={!message.trim()}
            className="w-full py-2 text-xs font-medium rounded transition-all"
            style={{
              background: message.trim() ? "#10b981" : "#27272a",
              color: message.trim() ? "#09090b" : "#71717a",
            }}
          >
            Enviar por WhatsApp
          </button>
        </div>
      )}
      <WhatsAppBubble />
    </>
  );
}
