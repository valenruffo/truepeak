"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import WhatsAppBubble from "@/components/WhatsAppBubble";
import { useLanguage } from "@/lib/i18n";

// ─── Icon Components ─────────────────────────────────────────────────────────

function IconLink() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function IconAnalysis() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12h4l3-9 4 18 3-9h6" />
    </svg>
  );
}

function IconHeadphones() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5z" />
      <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5z" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 4L12 13 2 4" />
    </svg>
  );
}

function IconWaveform() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="4" y1="8" x2="4" y2="16" /><line x1="8" y1="5" x2="8" y2="19" />
      <line x1="12" y1="3" x2="12" y2="21" /><line x1="16" y1="7" x2="16" y2="17" />
      <line x1="20" y1="10" x2="20" y2="14" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

function IconFingerprint() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12 10a4 4 0 0 0-4 4c0 2.5 1.5 5 4 6" />
      <path d="M12 10V6" /><path d="M8 14c0-2.5 1.5-5 4-6" />
      <path d="M16 14c0 2.5-1.5 5-4 6" /><path d="M16 10V6a4 4 0 0 0-4-4" />
      <path d="M8 10a8 8 0 0 1 8 0" /><path d="M6 14a10 10 0 0 1 12 0" />
    </svg>
  );
}

function IconFileAudio() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 22h-11a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l5 5v13a2 2 0 0 1-2 2z" />
      <polyline points="14 2 14 7 19 7" />
      <circle cx="12" cy="15" r="3" /><path d="M12 12v-3" />
    </svg>
  );
}

function IconTemplates() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─── Demo Simulation ───────────────────────────────────────────────────────────

function DemoSimulation() {
  const { t } = useLanguage();
  const [trackState, setTrackState] = useState<"analyzing" | "error" | "approved">("analyzing");
  const [trackName, setTrackName] = useState("");
  const [detectedIssue, setDetectedIssue] = useState("");
  const [metrics, setMetrics] = useState({ bpm: "---", lufs: "---", phase: "---" });
  const [bars, setBars] = useState(Array(24).fill(10));
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState(0);
  const tracks = [
    { name: "DJ_Krill_Midnight.wav", issueKey: "hero.demo.phase_inverted" as const, bpm: "128", lufs: "-6.2", phase: "INVERTIDA", state: "error" as const },
    { name: "ProducerX_Sunrise.wav", issueKey: "hero.demo.lufs_excess" as const, bpm: "140", lufs: "-4.1", phase: "OK", state: "error" as const },
    { name: "Anon_Groove_03.wav", issueKey: "hero.demo.off_tempo" as const, issueVars: { actual: "118", expected: "124" }, bpm: "118", lufs: "-14.3", phase: "OK", state: "error" as const },
    { name: "Mara_Deep_Cut.wav", issueKey: null, bpm: "122", lufs: "-14.0", phase: "OK", state: "approved" as const },
    { name: "Subsonic_Pulse.wav", issueKey: null, bpm: "126", lufs: "-12.8", phase: "OK", state: "approved" as const },
  ];
  const [trackIdx, setTrackIdx] = useState(0);

  useEffect(() => {
    const cycle = () => {
      const track = tracks[trackIdx];
      setTrackName(track.name); setTrackState("analyzing"); setProgress(0); setDetectedIssue(""); setMetrics({ bpm: "---", lufs: "---", phase: "---" });
      setTimeout(() => { setMetrics({ bpm: track.bpm, lufs: track.lufs, phase: track.phase }); setProgress(60); }, 800);
      setTimeout(() => { setProgress(100); if (track.state === "error") { setTrackState("error"); const issueText = track.issueKey ? (track.issueVars ? t(track.issueKey).replace("{actual}", track.issueVars.actual).replace("{expected}", track.issueVars.expected) : t(track.issueKey)) : ""; setDetectedIssue(issueText); } else { setTrackState("approved"); } }, 2200);
      setTimeout(() => { setTrackIdx((prev) => (prev + 1) % tracks.length); }, 4500);
    };
    cycle();
    const intervalRef = setInterval(cycle, 5000);
    return () => clearInterval(intervalRef);
  }, [trackIdx]);

  useEffect(() => {
    const interval = setInterval(() => {
      setBars((prev) => prev.map(() => { if (trackState === "error") return Math.random() * 20 + 5; if (trackState === "approved") return Math.random() * 60 + 30; return Math.random() * 40 + 10; }));
    }, 150);
    return () => clearInterval(interval);
  }, [trackState]);

  useEffect(() => {
    const interval = setInterval(() => {
      const newNotes = new Set<number>();
      const count = trackState === "analyzing" ? 6 : trackState === "error" ? 2 : 8;
      while (newNotes.size < count) { newNotes.add(Math.floor(Math.random() * 48)); }
      setActiveNotes(newNotes);
    }, 400);
    return () => clearInterval(interval);
  }, [trackState]);

  const stateColor = trackState === "error" ? "#ef4444" : trackState === "approved" ? "#10b981" : "#06b6d4";
  const stateLabel = trackState === "error" ? t("demo.rejected") : trackState === "approved" ? t("demo.approved") : t("demo.analyzing");

  return (
    <div className="rounded border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: stateColor }} />
          <span className="font-mono text-xs" style={{ color: stateColor }}>{stateLabel}</span>
        </div>
        <span className="font-mono text-xs text-muted truncate max-w-[200px]">{trackName}</span>
      </div>
      <div className="relative p-3">
        <div className="grid grid-cols-12 gap-[2px] mb-3">
          {Array.from({ length: 48 }).map((_, i) => (
            <div key={i} className="transition-all duration-300" style={{ height: "4px", background: activeNotes.has(i) ? stateColor : "var(--border-light)", opacity: activeNotes.has(i) ? 0.8 : 0.2 }} />
          ))}
        </div>
        <div className="flex items-end gap-[2px] h-14 mb-3 px-1">
          {bars.map((h, i) => (
            <div key={i} className="flex-1" style={{ height: `${h}%`, background: stateColor, opacity: 0.6, transition: "height 0.15s ease" }} />
          ))}
        </div>
        {trackState === "analyzing" && (
          <div className="absolute left-0 right-0 h-[1px]" style={{ background: "linear-gradient(90deg, transparent, rgba(16,185,129,0.4), transparent)", animation: "scan-line 3s linear infinite" }} />
        )}
      </div>
      <div className="grid grid-cols-3 gap-px" style={{ background: "var(--border)" }}>
        {[{ label: "BPM", value: metrics.bpm }, { label: "LUFS", value: metrics.lufs }, { label: "FASE", value: metrics.phase }].map((m) => (
          <div key={m.label} className="px-3 py-2 text-center" style={{ background: "var(--bg-card)" }}>
            <div className="text-[10px] uppercase tracking-wider text-muted font-mono">{m.label}</div>
            <div className="font-mono text-sm" style={{ color: m.value === "INVERTIDA" ? "#ef4444" : m.value === "---" ? "var(--text-muted-alt)" : "var(--text-primary)" }}>{m.value}</div>
          </div>
        ))}
      </div>
      {detectedIssue && (
        <div className="px-4 py-2 border-t flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
          <span className="font-mono text-xs" style={{ color: "#ef4444" }}>{detectedIssue}</span>
        </div>
      )}
      {trackState === "approved" && (
        <div className="px-4 py-2 border-t flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
          <span className="font-mono text-xs" style={{ color: "#10b981" }}>{t("demo.approved_detail")}</span>
        </div>
      )}
      <div className="h-px w-full" style={{ background: "var(--border-light)" }}>
        <div className="h-full transition-all duration-500 ease-out" style={{ width: `${progress}%`, background: stateColor }} />
      </div>
    </div>
  );
}

// ─── Nav ──────────────────────────────────────────────────────────────────────

function Nav() {
  const { t, lang, setLang } = useLanguage();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{
        background: scrolled ? "rgba(9,9,11,0.95)" : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottom: scrolled ? "1px solid var(--border)" : "1px solid transparent",
      }}
    >
      <div className="max-w-6xl mx-auto px-6 flex items-center justify-between" style={{ height: "56px" }}>
        <Link href="/">
          <img src="/logo.png" alt="True Peak AI" className="h-7 w-auto" />
        </Link>

        <div className="hidden md:flex items-center gap-8">
          <a href="#how-it-works" className="text-sm transition-colors cursor-pointer" style={{ color: "var(--text-muted)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
            {t("nav.how_it_works")}
          </a>
          <a href="#features" className="text-sm transition-colors cursor-pointer" style={{ color: "var(--text-muted)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
            {t("nav.features")}
          </a>
          <a href="#pricing" className="text-sm transition-colors cursor-pointer" style={{ color: "var(--text-muted)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
            {t("nav.pricing")}
          </a>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setLang(lang === "es" ? "en" : "es")}
            className="px-2 py-1 text-xs font-mono rounded transition-colors cursor-pointer"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.borderColor = "#52525b"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border)"; }}
          >
            {t("nav.lang_toggle")}
          </button>
          <Link
            href="/login"
            className="px-4 py-1.5 text-sm transition-colors rounded cursor-pointer"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.borderColor = "#52525b"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border)"; }}
          >
            {t("nav.login")}
          </Link>
          <Link
            href="/register"
            className="px-4 py-1.5 text-sm font-medium rounded transition-all hover:opacity-90 cursor-pointer"
            style={{ background: "#10b981", color: "#09090b" }}
          >
            {t("nav.register")}
          </Link>
        </div>
      </div>
    </nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
  const { t } = useLanguage();
  return (
    <section className="relative pt-32 pb-20 px-6 overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "linear-gradient(rgba(82,82,91,0.28) 1px, transparent 1px), linear-gradient(90deg, rgba(82,82,91,0.28) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black 20%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black 20%, transparent 100%)",
        }}
      />

      <div className="max-w-6xl mx-auto relative">
        <div className="grid md:grid-cols-2 gap-8 lg:gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded mb-6" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
              <span className="text-sm">🚀</span>
              <span className="text-xs font-mono" style={{ color: "#10b981" }}>{t("hero.badge")}</span>
            </div>

            <h1 className="font-bold text-4xl md:text-5xl lg:text-6xl leading-[1.08] tracking-tight mb-6" style={{ color: "var(--text-primary)" }}>
              {t("hero.title_line1")}<br />
              <span style={{ color: "#10b981" }}>{t("hero.title_line2")}</span>
            </h1>

            <p className="text-lg md:text-xl leading-relaxed mb-8 max-w-xl" style={{ color: "var(--text-muted)" }}>
              {t("hero.description")}
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href="#sellos"
                className="px-6 py-3 text-sm font-medium rounded transition-all hover:opacity-90 text-center cursor-pointer"
                style={{ background: "#10b981", color: "#09090b" }}
              >
                {t("hero.cta_primary")}
              </a>
              <a
                href="#djs"
                className="px-6 py-3 text-sm rounded transition-all text-center cursor-pointer"
                style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-secondary)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {t("hero.cta_secondary")}
              </a>
            </div>
          </div>
          <div className="hidden md:block max-w-sm mx-auto w-full">
            <DemoSimulation />
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Persona Selector Section ──────────────────────────────────────────────────

function PersonaSelectorSection() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<"labels" | "djs">("labels");

  // --- States for Labels interactive widget ---
  const [selectedGenre, setSelectedGenre] = useState<"techno" | "house" | "dnb">("techno");
  const [bpmRange, setBpmRange] = useState([125, 132]);
  const [lufsTarget, setLufsTarget] = useState(-11);

  useEffect(() => {
    if (selectedGenre === "techno") {
      setBpmRange([125, 132]);
      setLufsTarget(-11);
    } else if (selectedGenre === "house") {
      setBpmRange([120, 126]);
      setLufsTarget(-13);
    } else if (selectedGenre === "dnb") {
      setBpmRange([170, 175]);
      setLufsTarget(-9);
    }
  }, [selectedGenre]);

  // --- States for DJs interactive widget ---
  const [phaseCorrelation, setPhaseCorrelation] = useState(0.85);
  const [isPhaseInverted, setIsPhaseInverted] = useState(false);
  const [selectedKey, setSelectedKey] = useState("8A");

  useEffect(() => {
    let interval: any;
    if (isPhaseInverted) {
      interval = setInterval(() => {
        setPhaseCorrelation(Math.random() * 0.1 - 0.95);
      }, 250);
    } else {
      interval = setInterval(() => {
        setPhaseCorrelation(Math.random() * 0.08 + 0.82);
      }, 250);
    }
    return () => clearInterval(interval);
  }, [isPhaseInverted]);

  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash === "#djs") {
        setActiveTab("djs");
        const el = document.getElementById("personas");
        if (el) el.scrollIntoView({ behavior: "smooth" });
      } else if (window.location.hash === "#sellos") {
        setActiveTab("labels");
        const el = document.getElementById("personas");
        if (el) el.scrollIntoView({ behavior: "smooth" });
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    if (window.location.hash === "#djs" || window.location.hash === "#sellos") {
      handleHashChange();
    }
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const labelBenefits = [
    { icon: <IconShield />, title: t("sellos.benefit0.title"), desc: t("sellos.benefit0.desc") },
    { icon: <IconHeadphones />, title: t("sellos.benefit1.title"), desc: t("sellos.benefit1.desc") },
    { icon: <IconMail />, title: t("sellos.benefit2.title"), desc: t("sellos.benefit2.desc") },
  ];

  const djBenefits = [
    { icon: <IconFingerprint />, title: t("djs.benefit0.title"), desc: t("djs.benefit0.desc") },
    { icon: <IconShield />, title: t("djs.benefit1.title"), desc: t("djs.benefit1.desc") },
    { icon: <IconFileAudio />, title: t("djs.benefit2.title"), desc: t("djs.benefit2.desc") },
  ];

  const accentColor = activeTab === "labels" ? "#10b981" : "#06b6d4";
  const accentBg = activeTab === "labels" ? "rgba(16,185,129,0.06)" : "rgba(6,182,212,0.06)";
  const accentBorder = activeTab === "labels" ? "rgba(16,185,129,0.2)" : "rgba(6,182,212,0.2)";

  return (
    <section id="personas" className="py-24 px-6 relative overflow-hidden" style={{ borderTop: "1px solid var(--border)" }}>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 75% 50%, ${activeTab === "labels" ? "rgba(16,185,129,0.05)" : "rgba(6,182,212,0.05)"}, transparent 60%)`,
        }}
      />

      <div className="max-w-6xl mx-auto relative">
        <div className="flex justify-center mb-16">
          <div className="p-1 rounded-full border border-zinc-800 bg-zinc-950 flex relative">
            <div
              className="absolute top-1 bottom-1 rounded-full transition-all duration-300 ease-out"
              style={{
                left: activeTab === "labels" ? "4px" : "calc(50% + 2px)",
                width: "calc(50% - 6px)",
                background: accentColor,
              }}
            />
            <button
              onClick={() => setActiveTab("labels")}
              className="px-6 py-2 rounded-full text-xs font-mono tracking-wider uppercase font-semibold transition-all relative z-10 w-44 text-center cursor-pointer"
              style={{ color: activeTab === "labels" ? "#09090b" : "var(--text-muted)" }}
            >
              {t("sellos.section_label")}
            </button>
            <button
              onClick={() => setActiveTab("djs")}
              className="px-6 py-2 rounded-full text-xs font-mono tracking-wider uppercase font-semibold transition-all relative z-10 w-44 text-center cursor-pointer"
              style={{ color: activeTab === "djs" ? "#09090b" : "var(--text-muted)" }}
            >
              {t("djs.section_label")}
            </button>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="grid lg:grid-cols-12 gap-12 items-center"
          >
            {/* Left Col: Info */}
            <div className="lg:col-span-6 space-y-8">
              <div>
                <div className="text-xs font-mono uppercase tracking-wider mb-3" style={{ color: accentColor }}>
                  {activeTab === "labels" ? t("sellos.section_label") : t("djs.section_label")}
                </div>
                <h2 className="font-bold text-3xl md:text-4xl tracking-tight mb-4 leading-[1.1]" style={{ color: "var(--text-primary)" }}>
                  {activeTab === "labels" ? t("sellos.title") : t("djs.title")}
                </h2>
                <p className="text-base leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  {activeTab === "labels" ? t("sellos.description") : t("djs.description")}
                </p>
              </div>

              <div className="space-y-4">
                {(activeTab === "labels" ? labelBenefits : djBenefits).map((b, i) => (
                  <div key={i} className="flex gap-4 p-4 rounded border transition-all hover:border-zinc-700" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
                    <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0" style={{ background: accentBg, color: accentColor, border: `1px solid ${accentBorder}` }}>
                      {b.icon}
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm mb-1" style={{ color: "var(--text-primary)" }}>{b.title}</h3>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>{b.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Col: Widget */}
            <div className="lg:col-span-6">
              {activeTab === "labels" ? (
                <div className="rounded border overflow-hidden shadow-2xl" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
                  <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="font-mono text-xs text-emerald-500">A&R FILTER ENGINE ACTIVE</span>
                    </div>
                    <span className="font-mono text-[10px] text-muted">SETUP_CONFIG.json</span>
                  </div>

                  <div className="p-6 space-y-6">
                    <div className="grid grid-cols-12 gap-6 items-center">
                      {/* Gauge */}
                      <div className="col-span-5 flex flex-col items-center justify-center">
                        <div className="relative w-28 h-28 flex items-center justify-center">
                          <svg className="w-full h-full transform -rotate-90">
                            <circle cx="56" cy="56" r="48" stroke="rgba(24,24,27,0.8)" strokeWidth="6" fill="transparent" />
                            <motion.circle
                              cx="56"
                              cy="56"
                              r="48"
                              stroke="#10b981"
                              strokeWidth="6"
                              fill="transparent"
                              strokeDasharray={301.6}
                              initial={{ strokeDashoffset: 301.6 }}
                              animate={{ strokeDashoffset: 301.6 * (1 - 0.92) }}
                              transition={{ duration: 1.2, ease: "easeOut" }}
                            />
                          </svg>
                          <div className="absolute flex flex-col items-center justify-center">
                            <span className="text-2xl font-bold font-mono text-white">92%</span>
                            <span className="text-[8px] text-muted uppercase font-mono tracking-wider">Filtered</span>
                          </div>
                        </div>
                        <span className="text-[9px] text-muted text-center mt-2 font-mono">Demos auto-filtrados</span>
                      </div>

                      {/* Presets */}
                      <div className="col-span-7 space-y-3">
                        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">Firma Sónica Sugerida:</span>
                        <div className="flex flex-col gap-2">
                          {(["techno", "house", "dnb"] as const).map((genre) => (
                            <button
                              key={genre}
                              onClick={() => setSelectedGenre(genre)}
                              className="px-3 py-2 rounded text-left border transition-all text-xs font-mono font-medium flex items-center justify-between cursor-pointer"
                              style={{
                                background: selectedGenre === genre ? "rgba(16,185,129,0.06)" : "transparent",
                                borderColor: selectedGenre === genre ? "#10b981" : "var(--border)",
                                color: selectedGenre === genre ? "#10b981" : "var(--text-muted)",
                              }}
                            >
                              <span>{genre.toUpperCase()} Preset</span>
                              {selectedGenre === genre && <IconCheck />}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t" style={{ borderColor: "var(--border-light)" }}>
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                          <span>TEMPO LIMIT (BPM)</span>
                          <span className="text-emerald-500 font-bold">{bpmRange[0]} - {bpmRange[1]} BPM</span>
                        </div>
                        <div className="h-4 rounded bg-zinc-950 border border-zinc-900 relative flex items-center px-1">
                          <motion.div
                            className="h-2 rounded bg-emerald-500/20 border border-emerald-500/50 absolute"
                            animate={{
                              left: selectedGenre === "techno" ? "35%" : selectedGenre === "house" ? "20%" : "70%",
                              right: selectedGenre === "techno" ? "35%" : selectedGenre === "house" ? "55%" : "5%",
                            }}
                            transition={{ type: "spring", stiffness: 100 }}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                          <span>LOUDNESS TARGET (LUFS)</span>
                          <span className="text-emerald-500 font-bold">{lufsTarget} LUFS (±1.5)</span>
                        </div>
                        <div className="h-4 rounded bg-zinc-950 border border-zinc-900 relative flex items-center">
                          <motion.div
                            className="w-3.5 h-3.5 rounded-full bg-emerald-500 border border-emerald-400 absolute shadow-lg shadow-emerald-500/40"
                            animate={{
                              left: selectedGenre === "techno" ? "50%" : selectedGenre === "house" ? "30%" : "75%",
                            }}
                            style={{ x: "-50%" }}
                            transition={{ type: "spring", stiffness: 100 }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded border overflow-hidden shadow-2xl" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
                  <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${isPhaseInverted ? "bg-red-500 animate-ping" : "bg-cyan-500 animate-pulse"}`} />
                      <span className={`font-mono text-xs ${isPhaseInverted ? "text-red-500 font-bold" : "text-cyan-500"}`}>
                        {isPhaseInverted ? "ALERT: MONO PHASE CANCEL DETECTED" : "STEREO CORRELATION OPTIMAL"}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-muted">HARMONIC_ANALYSIS</span>
                  </div>

                  <div className="p-6 space-y-6">
                    <div className="space-y-3">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">Claves Camelot Compatibles:</span>
                      <div className="grid grid-cols-4 gap-2">
                        {["7A", "8A", "9A", "8B"].map((keyVal) => {
                          const isSelected = selectedKey === keyVal;
                          return (
                            <button
                              key={keyVal}
                              onClick={() => setSelectedKey(keyVal)}
                              className="p-3 rounded border text-center transition-all cursor-pointer bg-zinc-900/40"
                              style={{
                                borderColor: isSelected ? "#06b6d4" : "var(--border)",
                                color: isSelected ? "#06b6d4" : "var(--text-muted)",
                              }}
                            >
                              <div className="font-mono text-sm font-bold">{keyVal}</div>
                              <div className="text-[8px] font-mono mt-1 opacity-70">
                                {keyVal === "8A" ? "Am" : keyVal === "7A" ? "Dm" : keyVal === "9A" ? "Em" : "A"}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <span className="text-[9px] text-zinc-500 font-mono block text-center">
                        Mezcla armónica perfecta garantizada con tu track activo.
                      </span>
                    </div>

                    <div className="space-y-3 pt-4 border-t" style={{ borderColor: "var(--border-light)" }}>
                      <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                        <span>CORRELACIÓN DE FASE ESTÉREO</span>
                        <span className={`font-bold ${isPhaseInverted ? "text-red-500 animate-pulse" : "text-cyan-500"}`}>
                          {(phaseCorrelation).toFixed(2)} {isPhaseInverted ? "(Fase Invertida)" : "(Fase OK)"}
                        </span>
                      </div>

                      <div className="h-5 rounded bg-zinc-900 border border-zinc-800 relative flex items-center px-1">
                        <div className="absolute left-0 top-0 bottom-0 w-1/3 bg-red-500/5 rounded-l" />
                        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-cyan-500/5 rounded-r" />

                        <motion.div
                          className={`w-1 h-3 rounded absolute ${isPhaseInverted ? "bg-red-500 shadow-md shadow-red-500" : "bg-cyan-500 shadow-md shadow-cyan-500"}`}
                          animate={{
                            left: `${((phaseCorrelation + 1) / 2) * 94 + 3}%`,
                          }}
                          transition={{ type: "spring", stiffness: 120 }}
                        />

                        <div className="absolute left-[3%] text-[7px] font-mono text-zinc-600">-1.0</div>
                        <div className="absolute left-[50%] -translate-x-1/2 text-[7px] font-mono text-zinc-600">0.0 (Mono)</div>
                        <div className="absolute right-[3%] text-[7px] font-mono text-zinc-600">+1.0</div>
                      </div>

                      <div className="flex justify-end">
                        <button
                          onClick={() => setIsPhaseInverted(!isPhaseInverted)}
                          className="px-3 py-1.5 rounded text-[10px] font-mono border transition-all cursor-pointer flex items-center gap-1.5"
                          style={{
                            background: isPhaseInverted ? "rgba(239,68,68,0.1)" : "transparent",
                            borderColor: isPhaseInverted ? "#ef4444" : "var(--border)",
                            color: isPhaseInverted ? "#ef4444" : "var(--text-muted)",
                          }}
                        >
                          <span>⚠️ {isPhaseInverted ? "Simulación: Corregir Fase" : "Simular Error de Fase"}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

// ─── Tech Proof Section ───────────────────────────────────────────────────────

function TechProof() {
  const { t } = useLanguage();
  const cards = [
    { icon: <IconWaveform />, title: t("tech.card0.title"), desc: t("tech.card0.desc") },
    { icon: <IconAnalysis />, title: t("tech.card1.title"), desc: t("tech.card1.desc") },
    { icon: <IconShield />, title: t("tech.card2.title"), desc: t("tech.card2.desc") },
    { icon: <IconFingerprint />, title: t("tech.card3.title"), desc: t("tech.card3.desc") },
  ];

  return (
    <section id="tech-proof" className="py-20 px-6" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 text-center">
          <div className="text-xs font-mono uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>{t("tech.section_label")}</div>
          <h2 className="font-bold text-2xl md:text-3xl tracking-tight" style={{ color: "var(--text-primary)" }}>
            {t("tech.title")}
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c, i) => (
            <div key={i} className="p-5 rounded border transition-all hover:border-zinc-600" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
              <div className="w-9 h-9 rounded flex items-center justify-center mb-4" style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}>{c.icon}</div>
              <h3 className="font-semibold text-sm mb-2" style={{ color: "var(--text-primary)" }}>{c.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── How It Works ─────────────────────────────────────────────────────────────

const stepsData = [
  {
    key: "step.01",
    titleKey: "step.01.title" as const,
    descKey: "step.01.desc" as const,
  },
  {
    key: "step.02",
    titleKey: "step.02.title" as const,
    descKey: "step.02.desc" as const,
  },
  {
    key: "step.03",
    titleKey: "step.03.title" as const,
    descKey: "step.03.desc" as const,
  },
  {
    key: "step.04",
    titleKey: "step.04.title" as const,
    descKey: "step.04.desc" as const,
  },
];

function ConfiguratorSimulator({ t }: { t: (key: any) => string }) {
  const [preset, setPreset] = useState("techno"); // techno -> dnb -> house
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const presetTimer = setInterval(() => {
      setPreset((prev) => {
        if (prev === "techno") return "dnb";
        if (prev === "dnb") return "house";
        return "techno";
      });
    }, 4500);

    return () => clearInterval(presetTimer);
  }, []);

  useEffect(() => {
    const copyTimer = setInterval(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, 4500);

    return () => clearInterval(copyTimer);
  }, []);

  const signatureValues: Record<string, { bpmMin: number; bpmMax: number; lufs: number; tolerance: number }> = {
    techno: { bpmMin: 125, bpmMax: 132, lufs: -6.0, tolerance: 1.5 },
    dnb: { bpmMin: 170, bpmMax: 178, lufs: -5.0, tolerance: 1.0 },
    house: { bpmMin: 120, bpmMax: 126, lufs: -7.5, tolerance: 2.0 },
  };

  const current = signatureValues[preset];

  return (
    <div className="rounded-xl border overflow-hidden shadow-2xl transition-all duration-300" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)", background: "rgba(9,9,11,0.5)" }}>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ background: "#ef4444" }} />
          <div className="w-2 h-2 rounded-full" style={{ background: "#f59e0b" }} />
          <div className="w-2 h-2 rounded-full" style={{ background: "#10b981" }} />
        </div>
        <span className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>sonic_signature_config.yaml</span>
        <div className="w-10 h-2 bg-zinc-800 rounded-full" />
      </div>

      <div className="p-5 space-y-5">
        {/* Presets */}
        <div>
          <label className="text-[10px] font-mono uppercase tracking-wider block mb-2" style={{ color: "var(--text-muted)" }}>
            {t("config.presets_title") || "Ajuste Rápido / Genre Presets"}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["techno", "house", "dnb"] as const).map((g) => (
              <button
                key={g}
                className="py-1.5 px-3 rounded text-xs font-semibold capitalize border transition-all duration-300 relative overflow-hidden"
                style={{
                  background: preset === g ? "rgba(16, 185, 129, 0.1)" : "var(--bg-secondary)",
                  borderColor: preset === g ? "#10b981" : "var(--border)",
                  color: preset === g ? "#10b981" : "var(--text-muted)",
                }}
              >
                {g}
                {preset === g && (
                  <motion.div
                    layoutId="activePresetGlow"
                    className="absolute inset-0 border rounded pointer-events-none"
                    style={{ borderColor: "rgba(16, 185, 129, 0.5)" }}
                    initial={false}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Sliders */}
        <div className="space-y-4">
          {/* BPM */}
          <div>
            <div className="flex justify-between text-xs font-mono mb-1">
              <span style={{ color: "var(--text-muted)" }}>BPM Rango</span>
              <span className="font-semibold" style={{ color: "#10b981" }}>{current.bpmMin} - {current.bpmMax} BPM</span>
            </div>
            <div className="h-5 flex items-center relative">
              <div className="absolute inset-x-0 h-1.5 rounded" style={{ background: "var(--bg-secondary)" }} />
              {/* Highlight active range */}
              <motion.div
                className="absolute h-1.5 rounded border-l border-r"
                style={{ background: "rgba(16, 185, 129, 0.2)", borderColor: "#10b981" }}
                animate={{
                  left: `${((current.bpmMin - 80) / 120) * 100}%`,
                  width: `${((current.bpmMax - current.bpmMin) / 120) * 100}%`,
                }}
                transition={{ type: "spring", stiffness: 80, damping: 15 }}
              />
              {/* Knobs */}
              <motion.div
                className="absolute w-3.5 h-3.5 rounded-full shadow-md cursor-pointer border"
                style={{ background: "#10b981", borderColor: "#10b981" }}
                animate={{ left: `calc(${((current.bpmMin - 80) / 120) * 100}% - 7px)` }}
                transition={{ type: "spring", stiffness: 80, damping: 15 }}
              />
              <motion.div
                className="absolute w-3.5 h-3.5 rounded-full shadow-md cursor-pointer border"
                style={{ background: "#10b981", borderColor: "#10b981" }}
                animate={{ left: `calc(${((current.bpmMax - 80) / 120) * 100}% - 7px)` }}
                transition={{ type: "spring", stiffness: 80, damping: 15 }}
              />
            </div>
          </div>

          {/* LUFS */}
          <div>
            <div className="flex justify-between text-xs font-mono mb-1">
              <span style={{ color: "var(--text-muted)" }}>LUFS Objetivo</span>
              <span className="font-semibold" style={{ color: "#10b981" }}>{current.lufs.toFixed(1)} LUFS (±{current.tolerance.toFixed(1)})</span>
            </div>
            <div className="h-5 flex items-center relative">
              <div className="absolute inset-x-0 h-1.5 rounded" style={{ background: "var(--bg-secondary)" }} />
              {/* Highlight active range */}
              <motion.div
                className="absolute h-1.5 rounded border-l border-r"
                style={{ background: "rgba(16, 185, 129, 0.2)", borderColor: "#10b981" }}
                animate={{
                  left: `${((current.lufs - current.tolerance + 18) / 15) * 100}%`,
                  width: `${((current.tolerance * 2) / 15) * 100}%`,
                }}
                transition={{ type: "spring", stiffness: 80, damping: 15 }}
              />
              {/* Target Knob */}
              <motion.div
                className="absolute w-4 h-4 rounded border shadow-md rotate-45"
                style={{ background: "#10b981", borderColor: "#10b981" }}
                animate={{ left: `calc(${((current.lufs + 18) / 15) * 100}% - 8px)` }}
                transition={{ type: "spring", stiffness: 80, damping: 15 }}
              />
            </div>
          </div>
        </div>

        {/* Public Submission Link */}
        <div className="pt-4 border-t space-y-2" style={{ borderColor: "var(--border)" }}>
          <label className="text-[10px] font-mono uppercase tracking-wider block" style={{ color: "var(--text-muted)" }}>
            {t("link.slug_label") || "Link Público de Subida"}
          </label>
          <div className="flex items-center gap-2 p-2 rounded-lg border" style={{ background: "rgba(9,9,11,0.4)", borderColor: "var(--border)" }}>
            <span className="font-mono text-xs select-none" style={{ color: "var(--text-muted)" }}>truepeak.space/s/</span>
            <span className="font-mono text-xs flex-1 truncate" style={{ color: "var(--text-primary)" }}>aurora-records</span>
            <button
              className="py-1 px-3 rounded text-[10px] font-mono font-semibold transition-all relative overflow-hidden flex items-center gap-1"
              style={{
                background: copied ? "#10b981" : "var(--bg-secondary)",
                color: copied ? "#09090b" : "var(--text-primary)",
                border: "1px solid",
                borderColor: copied ? "#10b981" : "var(--border)",
              }}
            >
              {copied ? (
                <>
                  <IconCheck /> Copied!
                </>
              ) : (
                "Copy Link"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalyzerSimulator({ t }: { t: (key: any) => string }) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"idle" | "uploading" | "analyzing" | "complete">("idle");
  const [checks, setChecks] = useState({
    bpm: { status: "idle", value: "" },
    lufs: { status: "idle", value: "" },
    phase: { status: "idle", value: "" },
    key: { status: "idle", value: "" },
  });

  useEffect(() => {
    let active = true;

    const runSimulation = async () => {
      while (active) {
        setPhase("idle");
        setProgress(0);
        setChecks({
          bpm: { status: "idle", value: "" },
          lufs: { status: "idle", value: "" },
          phase: { status: "idle", value: "" },
          key: { status: "idle", value: "" },
        });
        await new Promise((r) => setTimeout(r, 1000));
        if (!active) break;

        setPhase("uploading");
        for (let p = 0; p <= 100; p += 5) {
          setProgress(p);
          await new Promise((r) => setTimeout(r, 60));
          if (!active) break;
        }
        if (!active) break;

        setPhase("analyzing");
        await new Promise((r) => setTimeout(r, 800));
        if (!active) break;

        setChecks((c) => ({ ...c, bpm: { status: "checking", value: "Detecting..." } }));
        await new Promise((r) => setTimeout(r, 700));
        setChecks((c) => ({ ...c, bpm: { status: "success", value: "126 BPM" } }));
        if (!active) break;

        setChecks((c) => ({ ...c, lufs: { status: "checking", value: "Measuring..." } }));
        await new Promise((r) => setTimeout(r, 700));
        setChecks((c) => ({ ...c, lufs: { status: "success", value: "-6.2 LUFS" } }));
        if (!active) break;

        setChecks((c) => ({ ...c, phase: { status: "checking", value: "Scanning correlation..." } }));
        await new Promise((r) => setTimeout(r, 700));
        setChecks((c) => ({ ...c, phase: { status: "success", value: "+0.85 (OK)" } }));
        if (!active) break;

        setChecks((c) => ({ ...c, key: { status: "checking", value: "Analyzing key..." } }));
        await new Promise((r) => setTimeout(r, 700));
        setChecks((c) => ({ ...c, key: { status: "success", value: "8A (Am)" } }));
        if (!active) break;

        setPhase("complete");
        await new Promise((r) => setTimeout(r, 3000));
      }
    };

    runSimulation();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="rounded-xl border overflow-hidden shadow-2xl transition-all duration-300" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      {/* Tab bar header */}
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)", background: "rgba(9,9,11,0.5)" }}>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ background: "#ef4444" }} />
          <div className="w-2 h-2 rounded-full" style={{ background: "#f59e0b" }} />
          <div className="w-2 h-2 rounded-full" style={{ background: "#10b981" }} />
        </div>
        <span className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>upload_portal_sub.wav</span>
        <div className="w-10 h-2 bg-zinc-800 rounded-full" />
      </div>

      <div className="p-5 space-y-4">
        {/* File Info */}
        <div className="flex items-center justify-between p-3 rounded-lg border" style={{ background: "rgba(9,9,11,0.2)", borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ background: "rgba(16,185,129,0.1)", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)" }}>
              <IconFileAudio />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>solaria_master_v2.wav</div>
              <div className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>42.8 MB · WAV format</div>
            </div>
          </div>
          <div className="text-right flex-shrink-0 ml-2">
            {phase === "uploading" && (
              <span className="text-xs font-mono font-bold" style={{ color: "#10b981" }}>{progress}%</span>
            )}
            {phase === "analyzing" && (
              <span className="text-xs font-mono animate-pulse" style={{ color: "#06b6d4" }}>{t("step.visual.analyzing") || "Analyzing..."}</span>
            )}
            {phase === "complete" && (
              <span className="text-xs font-mono font-semibold flex items-center gap-1" style={{ color: "#10b981" }}>
                <IconCheck /> Done
              </span>
            )}
          </div>
        </div>

        {/* Progress Bar / Waveform Visualizer */}
        <div className="relative rounded-lg p-3 border h-24 flex flex-col justify-between overflow-hidden" style={{ background: "rgba(9,9,11,0.4)", borderColor: "var(--border)" }}>
          {phase === "uploading" ? (
            <div className="h-full flex flex-col justify-center space-y-2">
              <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>Uploading master to secure node...</span>
              <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-secondary)" }}>
                <motion.div
                  className="h-full rounded-full animate-pulse"
                  style={{ width: `${progress}%`, background: "#10b981" }}
                  transition={{ ease: "easeInOut" }}
                />
              </div>
            </div>
          ) : (
            <>
              {/* Waveform representation */}
              <div className="flex items-end gap-[3px] h-12 w-full pt-2 relative">
                {/* Active scan line */}
                {phase === "analyzing" && (
                  <motion.div
                    className="absolute top-0 bottom-0 w-0.5 z-10"
                    style={{ background: "#06b6d4", boxShadow: "0 0 8px #06b6d4" }}
                    animate={{ left: ["0%", "100%"] }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                  />
                )}
                {Array.from({ length: 32 }).map((_, i) => {
                  const hFactor = Math.abs(Math.sin(i * 0.15) * 60 + Math.cos(i * 0.3) * 20);
                  const isChecked =
                    (i < 8 && checks.bpm.status === "success") ||
                    (i < 16 && checks.lufs.status === "success") ||
                    (i < 24 && checks.phase.status === "success") ||
                    (i < 32 && checks.key.status === "success");

                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-sm transition-all duration-300"
                      style={{
                        height: `${Math.max(15, hFactor)}%`,
                        background: phase === "complete" ? "#10b981" : isChecked ? "#06b6d4" : "var(--bg-secondary)",
                        opacity: phase === "complete" ? 0.7 : isChecked ? 0.8 : 0.2,
                      }}
                    />
                  );
                })}
              </div>
              <span className="text-[9px] font-mono flex justify-between" style={{ color: "var(--text-muted)" }}>
                <span>0.00s</span>
                <span>DSP Scan Complete</span>
                <span>6:12</span>
              </span>
            </>
          )}
        </div>

        {/* DSP Check List */}
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
          {/* BPM */}
          <div className="p-2.5 rounded border flex justify-between items-center" style={{ background: "rgba(9,9,11,0.2)", borderColor: "var(--border)" }}>
            <div>
              <span className="block text-[8px] uppercase" style={{ color: "var(--text-muted)" }}>Tempo</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{checks.bpm.value || "Waiting..."}</span>
            </div>
            {checks.bpm.status === "success" && (
              <span style={{ color: "#10b981" }}><IconCheck /></span>
            )}
            {checks.bpm.status === "checking" && (
              <span className="w-1.5 h-1.5 rounded-full animate-ping" style={{ background: "#06b6d4" }} />
            )}
          </div>

          {/* LUFS */}
          <div className="p-2.5 rounded border flex justify-between items-center" style={{ background: "rgba(9,9,11,0.2)", borderColor: "var(--border)" }}>
            <div>
              <span className="block text-[8px] uppercase" style={{ color: "var(--text-muted)" }}>Loudness</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{checks.lufs.value || "Waiting..."}</span>
            </div>
            {checks.lufs.status === "success" && (
              <span style={{ color: "#10b981" }}><IconCheck /></span>
            )}
            {checks.lufs.status === "checking" && (
              <span className="w-1.5 h-1.5 rounded-full animate-ping" style={{ background: "#06b6d4" }} />
            )}
          </div>

          {/* Phase */}
          <div className="p-2.5 rounded border flex justify-between items-center" style={{ background: "rgba(9,9,11,0.2)", borderColor: "var(--border)" }}>
            <div>
              <span className="block text-[8px] uppercase" style={{ color: "var(--text-muted)" }}>Fase</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{checks.phase.value || "Waiting..."}</span>
            </div>
            {checks.phase.status === "success" && (
              <span style={{ color: "#10b981" }}><IconCheck /></span>
            )}
            {checks.phase.status === "checking" && (
              <span className="w-1.5 h-1.5 rounded-full animate-ping" style={{ background: "#06b6d4" }} />
            )}
          </div>

          {/* Key */}
          <div className="p-2.5 rounded border flex justify-between items-center" style={{ background: "rgba(9,9,11,0.2)", borderColor: "var(--border)" }}>
            <div>
              <span className="block text-[8px] uppercase" style={{ color: "var(--text-muted)" }}>Escala</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{checks.key.value || "Waiting..."}</span>
            </div>
            {checks.key.status === "success" && (
              <span style={{ color: "#10b981" }}><IconCheck /></span>
            )}
            {checks.key.status === "checking" && (
              <span className="w-1.5 h-1.5 rounded-full animate-ping" style={{ background: "#06b6d4" }} />
            )}
          </div>
        </div>

        {/* MP3 Conversion Success Alert */}
        <AnimatePresence>
          {phase === "complete" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              className="border p-2.5 text-center rounded text-[10px] font-mono"
              style={{ background: "rgba(16,185,129,0.05)", borderColor: "rgba(16,185,129,0.2)", color: "#10b981" }}
            >
              ✓ Conversión a MP3 320kbps y firma sónica validados.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function KanbanSimulator({ t }: { t: (key: any) => string }) {
  const [stage, setStage] = useState<"idle" | "moving" | "done">("idle");

  useEffect(() => {
    let active = true;

    const runSimulation = async () => {
      while (active) {
        setStage("idle");
        await new Promise((r) => setTimeout(r, 1500));
        if (!active) break;

        setStage("moving");
        await new Promise((r) => setTimeout(r, 1200));
        if (!active) break;

        setStage("done");
        await new Promise((r) => setTimeout(r, 3300));
      }
    };

    runSimulation();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="rounded-xl border overflow-hidden shadow-2xl transition-all duration-300 flex flex-col h-[280px]" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)", background: "rgba(9,9,11,0.5)" }}>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ background: "#ef4444" }} />
          <div className="w-2 h-2 rounded-full" style={{ background: "#f59e0b" }} />
          <div className="w-2 h-2 rounded-full" style={{ background: "#10b981" }} />
        </div>
        <span className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>kanban_inbox_live</span>
        <div className="w-10 h-2 bg-zinc-800 rounded-full" />
      </div>

      {/* Board Columns */}
      <div className="flex-1 grid grid-cols-2 gap-3 p-4 relative overflow-hidden" style={{ background: "rgba(9,9,11,0.2)" }}>
        {/* Column: Inbox */}
        <div className="flex flex-col gap-2 rounded-lg p-2.5 border" style={{ background: "rgba(9,9,11,0.3)", borderColor: "var(--border)" }}>
          <span className="text-[10px] font-semibold font-mono flex items-center justify-between px-1" style={{ color: "var(--text-muted)" }}>
            <span>INBOX</span>
            <span className="w-4 h-4 rounded text-center text-[9px] flex items-center justify-center font-mono" style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}>
              {stage === "idle" ? "1" : "0"}
            </span>
          </span>

          <div className="relative h-20">
            {stage === "idle" && (
              <motion.div
                layoutId="kanban-card"
                className="absolute inset-x-0 p-2.5 rounded shadow-md flex flex-col justify-between border"
                style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
                transition={{ type: "spring", stiffness: 90, damping: 15 }}
              >
                <div>
                  <div className="text-[10px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>Midnight Protocol</div>
                  <div className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>BPM 126 · LUFS -6.2</div>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-[8px] px-1.5 py-0.5 rounded font-mono uppercase border" style={{ background: "rgba(245,158,11,0.08)", color: "#f59e0b", borderColor: "rgba(245,158,11,0.2)" }}>
                    Pending
                  </span>
                  <span className="text-[8px] font-mono" style={{ color: "var(--text-muted)" }}>3:42</span>
                </div>
              </motion.div>
            )}

            {stage === "moving" && (
              <motion.div
                layoutId="kanban-card"
                className="absolute p-2.5 rounded shadow-2xl flex flex-col justify-between z-20 border"
                style={{ width: "calc(100% - 2px)", background: "var(--bg-card)", borderColor: "var(--border)" }}
                animate={{
                  x: [0, 160],
                  y: [0, -5, 0],
                  rotate: [0, 2, 0],
                  scale: [1, 1.05, 1],
                }}
                transition={{ duration: 1.1, ease: "easeInOut" }}
              >
                <div>
                  <div className="text-[10px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>Midnight Protocol</div>
                  <div className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>BPM 126 · LUFS -6.2</div>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-[8px] px-1.5 py-0.5 rounded font-mono uppercase border" style={{ background: "rgba(245,158,11,0.08)", color: "#f59e0b", borderColor: "rgba(245,158,11,0.2)" }}>
                    Pending
                  </span>
                  <span className="text-[8px] font-mono" style={{ color: "var(--text-muted)" }}>3:42</span>
                </div>
              </motion.div>
            )}
          </div>
        </div>

        {/* Column: Shortlist */}
        <div className="flex flex-col gap-2 rounded-lg p-2.5 border" style={{ background: "rgba(9,9,11,0.3)", borderColor: "var(--border)" }}>
          <span className="text-[10px] font-semibold font-mono flex items-center justify-between px-1" style={{ color: "var(--text-muted)" }}>
            <span>SHORTLIST</span>
            <span className="w-4 h-4 rounded text-center text-[9px] flex items-center justify-center font-mono font-bold" style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}>
              {stage === "done" ? "1" : "0"}
            </span>
          </span>

          <div className="relative h-20">
            {stage === "done" && (
              <motion.div
                layoutId="kanban-card"
                className="absolute inset-x-0 p-2.5 rounded shadow-md flex flex-col justify-between border"
                style={{ background: "var(--bg-card)", borderColor: "rgba(16,185,129,0.2)" }}
                transition={{ type: "spring", stiffness: 90, damping: 15 }}
              >
                <div>
                  <div className="text-[10px] font-semibold truncate" style={{ color: "#10b981" }}>Midnight Protocol</div>
                  <div className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>BPM 126 · LUFS -6.2</div>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-[8px] px-1.5 py-0.5 rounded font-mono uppercase border" style={{ background: "rgba(16,185,129,0.08)", color: "#10b981", borderColor: "rgba(16,185,129,0.2)" }}>
                    Shortlisted
                  </span>
                  <span className="text-[8px] font-mono" style={{ color: "var(--text-muted)" }}>3:42</span>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Embedded Player bar */}
      <div className="px-4 py-3 border-t flex items-center gap-3 bg-zinc-950/70" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          {/* Play/Pause Button */}
          <button className="w-6 h-6 rounded-full flex items-center justify-center text-black shadow-lg" style={{ background: "#10b981" }}>
            {stage === "done" ? (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: "1.5px" }}>
                <polygon points="5 3 19 12 5 21" />
              </svg>
            )}
          </button>
        </div>
        <div className="flex-1 flex flex-col justify-center min-w-0">
          <div className="text-[10px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
            {stage === "done" ? "Midnight Protocol" : "No track selected"}
          </div>
          {stage === "done" ? (
            <div className="flex items-end gap-[1.5px] h-3.5 mt-0.5">
              {Array.from({ length: 24 }).map((_, i) => {
                const randomHeight = Math.floor(Math.random() * 85) + 15;
                return (
                  <motion.div
                    key={i}
                    className="flex-1 rounded-sm"
                    style={{ background: "#10b981" }}
                    animate={{ height: [`${randomHeight}%`, `${100 - randomHeight}%`, `${randomHeight}%`] }}
                    transition={{ repeat: Infinity, duration: 0.8 + (i % 3) * 0.2, ease: "easeInOut" }}
                  />
                );
              })}
            </div>
          ) : (
            <div className="h-0.5 rounded-full w-full mt-1.5" style={{ background: "var(--bg-secondary)" }} />
          )}
        </div>
      </div>
    </div>
  );
}

function CRMSimulator({ t }: { t: (key: any) => string }) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"typing" | "idle_ready" | "sending" | "sent">("typing");
  const fullText = "Hola Krill,\n\nGracias por enviarnos 'Midnight Protocol'. Nos encantó la energía del track. Cumple con los parámetros de la firma (126 BPM, -6.2 LUFS).\n\nLo sumamos a la Shortlist para el próximo release.\n\nSaludos!";

  useEffect(() => {
    let active = true;

    const runFlow = async () => {
      while (active) {
        setPhase("typing");
        setText("");
        await new Promise((r) => setTimeout(r, 800));

        let currentString = "";
        for (let i = 0; i < fullText.length; i++) {
          if (!active) return;
          currentString += fullText[i];
          setText(currentString);
          await new Promise((r) => setTimeout(r, fullText[i] === "\n" ? 250 : 25));
        }

        if (!active) return;
        setPhase("idle_ready");
        await new Promise((r) => setTimeout(r, 1200));

        if (!active) return;
        setPhase("sending");
        await new Promise((r) => setTimeout(r, 1500));

        if (!active) return;
        setPhase("sent");
        await new Promise((r) => setTimeout(r, 3500));
      }
    };

    runFlow();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="rounded-xl border overflow-hidden shadow-2xl transition-all duration-300 flex flex-col h-[280px]" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)", background: "rgba(9,9,11,0.5)" }}>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ background: "#ef4444" }} />
          <div className="w-2 h-2 rounded-full" style={{ background: "#f59e0b" }} />
          <div className="w-2 h-2 rounded-full" style={{ background: "#10b981" }} />
        </div>
        <span className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>email_crm_assistant</span>
        <div className="w-10 h-2 bg-zinc-800 rounded-full" />
      </div>

      <AnimatePresence mode="wait">
        {phase !== "sent" ? (
          <motion.div
            key="composer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col p-4 space-y-3"
            style={{ background: "rgba(9,9,11,0.2)" }}
          >
            {/* Headers fields */}
            <div className="space-y-1 text-[10px] font-mono border-b pb-2" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2">
                <span className="w-10" style={{ color: "var(--text-muted)" }}>Para:</span>
                <span style={{ color: "var(--text-primary)" }}>dj_krill@email.com</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-10" style={{ color: "var(--text-muted)" }}>Asunto:</span>
                <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>Demo Recibida - Midnight Protocol (Aprobada)</span>
              </div>
            </div>

            {/* Body TextArea */}
            <div className="flex-1 rounded-lg p-2.5 font-mono text-[9.5px] leading-relaxed select-none overflow-y-auto whitespace-pre-wrap relative border" style={{ background: "rgba(9,9,11,0.4)", borderColor: "var(--border)", color: "var(--text-primary)" }}>
              {text}
              {phase === "typing" && (
                <span className="inline-block w-1.5 h-3 ml-0.5 animate-pulse" style={{ background: "#10b981" }} />
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-between items-center">
              <span className="text-[8px] font-mono" style={{ color: "var(--text-muted)" }}>AI-Assisted drafting</span>
              <button
                className="py-1.5 px-4 rounded text-xs font-semibold font-mono flex items-center gap-1.5 transition-all duration-300 relative overflow-hidden"
                style={{
                  background: phase === "sending" ? "var(--bg-secondary)" : "#10b981",
                  color: phase === "sending" ? "var(--text-muted)" : "#09090b",
                  border: phase === "sending" ? "1px solid var(--border)" : "none",
                }}
                disabled={phase === "sending"}
              >
                {phase === "sending" ? (
                  <>
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Enviando...
                  </>
                ) : (
                  <>
                    <span>Enviar</span>
                    <motion.span
                      animate={phase === "idle_ready" ? { x: [0, 3, 0] } : {}}
                      transition={{ repeat: Infinity, duration: 1 }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                    </motion.span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center text-center p-6 relative overflow-hidden"
            style={{ background: "rgba(9,9,11,0.2)" }}
          >
            <div className="absolute inset-0 pointer-events-none opacity-20">
              {Array.from({ length: 8 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-1 h-1 rounded-full"
                  style={{
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                    background: "#10b981",
                  }}
                  animate={{ y: [-10, 10], opacity: [0, 1, 0] }}
                  transition={{ repeat: Infinity, duration: 2 + i * 0.5, delay: i * 0.1 }}
                />
              ))}
            </div>

            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 12 }}
              className="w-12 h-12 rounded-full flex items-center justify-center mb-3 border"
              style={{ background: "rgba(16,185,129,0.1)", borderColor: "rgba(16,185,129,0.2)", color: "#10b981" }}
            >
              <IconCheck />
            </motion.div>
            <h4 className="text-xs font-bold uppercase tracking-wider font-mono" style={{ color: "var(--text-primary)" }}>Email Enviado</h4>
            <p className="text-[10px] max-w-[200px] mt-1.5 font-mono leading-relaxed" style={{ color: "var(--text-muted)" }}>
              El productor ha recibido la respuesta con los datos de firma sónica.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepVisual({ step, t }: { step: number; t: (key: any) => string }) {
  const visuals: Record<number, React.ReactNode> = {
    0: <ConfiguratorSimulator t={t} />,
    1: <AnalyzerSimulator t={t} />,
    2: <KanbanSimulator t={t} />,
    3: <CRMSimulator t={t} />,
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {visuals[step]}
    </div>
  );
}

function HowItWorks() {
  const { t } = useLanguage();
  const [activeStep, setActiveStep] = useState(0);

  return (
    <section id="how-it-works" className="py-20 px-6" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="max-w-6xl mx-auto">
        <div className="mb-12">
          <div className="text-xs font-mono uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>{t("how_it_works.section_label")}</div>
          <h2 className="font-bold text-2xl md:text-3xl tracking-tight" style={{ color: "var(--text-primary)" }}>
            {t("how_it_works.title")} <span style={{ color: "#10b981" }}>{t("how_it_works.title_accent")}</span>
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-8 lg:gap-12">
          {/* Left: Steps */}
          <div className="space-y-1">
            {stepsData.map((step, i) => (
              <button
                key={step.key}
                onClick={() => setActiveStep(i)}
                className="w-full text-left p-4 rounded border transition-all cursor-pointer"
                style={{
                  background: activeStep === i ? "var(--bg-card)" : "transparent",
                  borderColor: activeStep === i ? "#10b981" : "transparent",
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-bold flex-shrink-0 mt-0.5 transition-all"
                    style={{
                      background: activeStep === i ? "#10b981" : "var(--bg-secondary)",
                      color: activeStep === i ? "#09090b" : "var(--text-muted)",
                    }}
                  >
                    {i + 1}
                  </div>
                  <div>
                    <div className="font-semibold text-sm mb-1" style={{ color: activeStep === i ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {t(step.titleKey)}
                    </div>
                    {activeStep === i && (
                      <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                        {t(step.descKey)}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Right: Visual */}
          <div className="hidden md:block">
            <div className="sticky top-24">
              <StepVisual step={activeStep} t={t} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Features ─────────────────────────────────────────────────────────────────

function Features() {
  const { t } = useLanguage();
  const features = [
    { icon: <IconWaveform />, title: t("feature.0.title"), desc: t("feature.0.desc") },
    { icon: <IconShield />, title: t("feature.1.title"), desc: t("feature.1.desc") },
    { icon: <IconFingerprint />, title: t("feature.2.title"), desc: t("feature.2.desc") },
    { icon: <IconFileAudio />, title: t("feature.3.title"), desc: t("feature.3.desc") },
    { icon: <IconTemplates />, title: t("feature.4.title"), desc: t("feature.4.desc") },
    { icon: <IconMail />, title: t("feature.5.title"), desc: t("feature.5.desc") },
  ];

  return (
    <section id="features" className="py-20 px-6" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="max-w-6xl mx-auto">
        <div className="mb-12">
          <div className="text-xs font-mono uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>{t("features.section_label")}</div>
          <h2 className="font-bold text-2xl md:text-3xl tracking-tight" style={{ color: "var(--text-primary)" }}>
            {t("features.title")} <span style={{ color: "#10b981" }}>{t("features.title_accent")}</span>
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <div key={i} className="p-5 rounded border transition-all hover:border-zinc-600" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
              <div className="w-9 h-9 rounded flex items-center justify-center mb-4" style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}>{f.icon}</div>
              <h3 className="font-semibold text-sm mb-2" style={{ color: "var(--text-primary)" }}>{f.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

function Pricing() {
  const { t } = useLanguage();
  const tiers = [
    {
      name: t("pricing.free"),
      price: t("pricing.free_price"),
      cta: t("pricing.free_cta"),
      href: "/register",
      border: "var(--border)",
      bg: "var(--bg-secondary)",
      btnStyle: { border: "1px solid var(--border)", color: "var(--text-primary)" } as React.CSSProperties,
      features: [0, 1, 2, 3],
      keyPrefix: "pricing.free",
    },
    {
      name: t("pricing.indie"),
      price: t("pricing.indie_price"),
      cta: t("pricing.indie_cta"),
      href: "/register",
      border: "#10b981",
      bg: "var(--bg-secondary)",
      btnStyle: { background: "#10b981", color: "#09090b" } as React.CSSProperties,
      features: [0, 1, 2, 3, 4, 5, 6],
      keyPrefix: "pricing.indie",
    },
    {
      name: t("pricing.pro"),
      price: t("pricing.pro_price"),
      cta: t("pricing.pro_cta"),
      href: "/register",
      border: "var(--border)",
      bg: "var(--bg-secondary)",
      btnStyle: { border: "1px solid var(--border)", color: "var(--text-primary)" } as React.CSSProperties,
      features: [0, 1, 2, 3, 4, 5, 6],
      keyPrefix: "pricing.pro",
    },
  ];

  return (
    <section id="pricing" className="py-20 px-6" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="max-w-5xl mx-auto">
        <div className="mb-12 text-center">
          <div className="text-xs font-mono uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>{t("pricing.section_label")}</div>
          <h2 className="font-bold text-2xl md:text-3xl tracking-tight" style={{ color: "var(--text-primary)" }}>
            {t("pricing.title")} <span style={{ color: "#10b981" }}>{t("pricing.title_accent")}</span>
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {tiers.map((tier) => (
            <div key={tier.name} className="p-6 rounded border" style={{ background: tier.bg, borderColor: tier.border }}>
              <div className="flex items-baseline justify-between mb-6">
                <span className="text-xs font-mono uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{tier.name}</span>
                <div className="flex items-baseline gap-1">
                  <span className="font-bold text-3xl" style={{ color: "var(--text-primary)" }}>{tier.price}</span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("pricing.per_month")}</span>
                </div>
              </div>

              <ul className="space-y-3 mb-8">
                {tier.features.map((i) => (
                  <li key={i} className="flex items-start gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
                    <span style={{ color: "#10b981", flexShrink: 0, marginTop: "2px" }}><IconCheck /></span>
                    {t(`${tier.keyPrefix}.${i}` as any)}
                  </li>
                ))}
              </ul>

              {tier.href.startsWith("/") ? (
                <Link href={tier.href} className="w-full py-2.5 text-sm font-medium rounded transition-all hover:opacity-90 block text-center cursor-pointer" style={tier.btnStyle}>
                  {tier.cta}
                </Link>
              ) : (
                <a href={tier.href} target="_blank" rel="noopener noreferrer" className="w-full py-2.5 text-sm font-medium rounded transition-all hover:opacity-90 block text-center cursor-pointer" style={tier.btnStyle}>
                  {tier.cta}
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  const { t } = useLanguage();
  return (
    <footer className="py-8 px-6" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <img src="/logo.png" alt="True Peak AI" className="h-8 w-auto" />

        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t("footer.copy")}
        </div>

        <div className="flex items-center gap-6 text-xs" style={{ color: "var(--text-muted)" }}>
          <Link href="/login" className="cursor-pointer" style={{ color: "var(--text-muted)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
            {t("nav.login")}
          </Link>
          <Link href="/register" className="cursor-pointer" style={{ color: "var(--text-muted)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
            {t("nav.register")}
          </Link>
          <Link href="/terms-of-service" className="cursor-pointer" style={{ color: "var(--text-muted)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
            {t("footer.terms")}
          </Link>
          <Link href="/privacy-policy" className="cursor-pointer" style={{ color: "var(--text-muted)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
            {t("footer.privacy")}
          </Link>
        </div>
      </div>
    </footer>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}>
      <style>{`
        @keyframes scan-line {
          0% { top: 0; }
          100% { top: 100%; }
        }
      `}</style>
      <Nav />
      <Hero />
      <PersonaSelectorSection />
      <TechProof />
      <HowItWorks />
      <Features />
      <Pricing />
      <Footer />
      <WhatsAppBubble />
    </div>
  );
}
