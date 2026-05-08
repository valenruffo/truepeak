"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
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
    { name: "DJ_Krill_Midnight.wav", issue: "Fase invertida en L/R", bpm: "128", lufs: "-6.2", phase: "INVERTIDA", state: "error" as const },
    { name: "ProducerX_Sunrise.wav", issue: "LUFS excesivo", bpm: "140", lufs: "-4.1", phase: "OK", state: "error" as const },
    { name: "Anon_Groove_03.wav", issue: "Fuera de tempo (118 vs 124)", bpm: "118", lufs: "-14.3", phase: "OK", state: "error" as const },
    { name: "Mara_Deep_Cut.wav", issue: null, bpm: "122", lufs: "-14.0", phase: "OK", state: "approved" as const },
    { name: "Subsonic_Pulse.wav", issue: null, bpm: "126", lufs: "-12.8", phase: "OK", state: "approved" as const },
  ];
  const [trackIdx, setTrackIdx] = useState(0);

  useEffect(() => {
    const cycle = () => {
      const track = tracks[trackIdx];
      setTrackName(track.name); setTrackState("analyzing"); setProgress(0); setDetectedIssue(""); setMetrics({ bpm: "---", lufs: "---", phase: "---" });
      setTimeout(() => { setMetrics({ bpm: track.bpm, lufs: track.lufs, phase: track.phase }); setProgress(60); }, 800);
      setTimeout(() => { setProgress(100); if (track.state === "error") { setTrackState("error"); setDetectedIssue(track.issue || ""); } else { setTrackState("approved"); } }, 2200);
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
  const { t } = useLanguage();
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
          backgroundImage: "linear-gradient(rgba(39,39,42,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(39,39,42,0.15) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black 20%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black 20%, transparent 100%)",
        }}
      />

      <div className="max-w-6xl mx-auto relative">
        <div className="grid md:grid-cols-2 gap-8 lg:gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded mb-6" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#10b981" }} />
              <span className="text-xs font-mono" style={{ color: "#10b981" }}>{t("hero.badge")}</span>
            </div>

            <h1 className="font-bold text-4xl md:text-5xl lg:text-6xl leading-[1.08] tracking-tight mb-6" style={{ color: "var(--text-primary)" }}>
              True Peak AI
            </h1>

            <p className="text-lg md:text-xl leading-relaxed mb-8 max-w-xl" style={{ color: "var(--text-muted)" }}>
              {t("hero.description")}
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/register"
                className="px-6 py-3 text-sm font-medium rounded transition-all hover:opacity-90 text-center cursor-pointer"
                style={{ background: "#10b981", color: "#09090b" }}
              >
                {t("hero.cta_primary")}
              </Link>
              <a
                href="#how-it-works"
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

// ─── How It Works ─────────────────────────────────────────────────────────────

function HowItWorks() {
  const { t } = useLanguage();
  const steps = [
    { num: "01", title: t("step.01.title"), desc: t("step.01.desc"), icon: <IconLink /> },
    { num: "02", title: t("step.02.title"), desc: t("step.02.desc"), icon: <IconAnalysis /> },
    { num: "03", title: t("step.03.title"), desc: t("step.03.desc"), icon: <IconHeadphones /> },
    { num: "04", title: t("step.04.title"), desc: t("step.04.desc"), icon: <IconMail /> },
  ];

  return (
    <section id="how-it-works" className="py-20 px-6" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="max-w-6xl mx-auto">
        <div className="mb-12">
          <div className="text-xs font-mono uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>{t("how_it_works.section_label")}</div>
          <h2 className="font-bold text-2xl md:text-3xl tracking-tight" style={{ color: "var(--text-primary)" }}>
            {t("how_it_works.title")} <span style={{ color: "#10b981" }}>{t("how_it_works.title_accent")}</span>
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {steps.map((step) => (
            <div key={step.num} className="p-5 rounded border transition-all hover:border-zinc-600" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}>{step.icon}</div>
                <span className="font-mono text-xs" style={{ color: "var(--text-muted-alt)" }}>{step.num}</span>
              </div>
              <h3 className="font-semibold text-sm mb-2" style={{ color: "var(--text-primary)" }}>{step.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{step.desc}</p>
            </div>
          ))}
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

const checkoutUrl = "https://truepeak.lemonsqueezy.com/checkout/buy/60230548-372d-421b-8b00-f15a78817c76";

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
      href: checkoutUrl,
      border: "#10b981",
      bg: "var(--bg-secondary)",
      btnStyle: { background: "#10b981", color: "#09090b" } as React.CSSProperties,
      features: [0, 1, 2, 3, 4],
      keyPrefix: "pricing.indie",
    },
    {
      name: t("pricing.pro"),
      price: t("pricing.pro_price"),
      cta: t("pricing.pro_cta"),
      href: checkoutUrl,
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
      <HowItWorks />
      <Features />
      <Pricing />
      <Footer />
      <WhatsAppBubble />
    </div>
  );
}
