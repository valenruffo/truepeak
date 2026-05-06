"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import WhatsAppBubble from "@/components/WhatsAppBubble";

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

// ─── Nav ──────────────────────────────────────────────────────────────────────

function Nav() {
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
        borderBottom: scrolled ? "1px solid #27272a" : "1px solid transparent",
      }}
    >
      <div className="max-w-6xl mx-auto px-6 flex items-center justify-between" style={{ height: "56px" }}>
        <Link href="/">
          <img src="/logo.png" alt="True Peak AI" className="h-7 w-auto" />
        </Link>

        <div className="hidden md:flex items-center gap-8">
          <a href="#how-it-works" className="text-sm transition-colors cursor-pointer" style={{ color: "#71717a" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#fafafa")} onMouseLeave={(e) => (e.currentTarget.style.color = "#71717a")}>
            Como funciona
          </a>
          <a href="#features" className="text-sm transition-colors cursor-pointer" style={{ color: "#71717a" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#fafafa")} onMouseLeave={(e) => (e.currentTarget.style.color = "#71717a")}>
            Funcionalidades
          </a>
          <a href="#pricing" className="text-sm transition-colors cursor-pointer" style={{ color: "#71717a" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#fafafa")} onMouseLeave={(e) => (e.currentTarget.style.color = "#71717a")}>
            Precios
          </a>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="px-4 py-1.5 text-sm transition-colors rounded cursor-pointer"
            style={{ color: "#71717a", border: "1px solid #27272a" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#fafafa"; e.currentTarget.style.borderColor = "#52525b"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#71717a"; e.currentTarget.style.borderColor = "#27272a"; }}
          >
            Iniciar sesion
          </Link>
          <Link
            href="/register"
            className="px-4 py-1.5 text-sm font-medium rounded transition-all hover:opacity-90 cursor-pointer"
            style={{ background: "#10b981", color: "#09090b" }}
          >
            Registrarse
          </Link>
        </div>
      </div>
    </nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative pt-32 pb-20 px-6 overflow-hidden">
      {/* Subtle grid background */}
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
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded mb-6" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#10b981" }} />
            <span className="text-xs font-mono" style={{ color: "#10b981" }}>B2B SaaS para sellos electronicos</span>
          </div>

          <h1 className="font-bold text-4xl md:text-5xl lg:text-6xl leading-[1.08] tracking-tight mb-6" style={{ color: "#fafafa" }}>
            True Peak AI
          </h1>

          <p className="text-lg md:text-xl leading-relaxed mb-8 max-w-xl" style={{ color: "#71717a" }}>
            El primer filtro de demos con analisis tecnico automatico.
            Setea la firma sonica de tu sello y deja que el motor descarte
            los tracks fuera de standard antes de que lleguen a tus oidos.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/register"
              className="px-6 py-3 text-sm font-medium rounded transition-all hover:opacity-90 text-center cursor-pointer"
              style={{ background: "#10b981", color: "#09090b" }}
            >
              Comenzar gratis
            </Link>
            <a
              href="#how-it-works"
              className="px-6 py-3 text-sm rounded transition-all text-center cursor-pointer"
              style={{ border: "1px solid #27272a", color: "#fafafa" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#0c0c0e")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              Ver como funciona
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── How It Works ─────────────────────────────────────────────────────────────

const steps = [
  {
    num: "01",
    title: "Comparti tu link",
    desc: "Los productores envian sus tracks a traves de tu URL personalizada. Sin registro, sin friccion. Solo suben el WAV y listo.",
    icon: <IconLink />,
  },
  {
    num: "02",
    title: "Analisis automatico",
    desc: "La IA analiza BPM, LUFS, fase, headroom y tonalidad musical. Rechaza automaticamente los tracks que no cumplen tus reglas.",
    icon: <IconAnalysis />,
  },
  {
    num: "03",
    title: "Escucha y decidi",
    desc: "Revisa los tracks pendientes en tu dashboard. Escucha, aproba o rechaza. Solo llega a tus oidos lo que vale la pena.",
    icon: <IconHeadphones />,
  },
  {
    num: "04",
    title: "Contacta productores",
    desc: "Envia emails desde la seccion Emails con plantillas pre-armadas. Variables como nombre y track se rellenan solas.",
    icon: <IconMail />,
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 px-6" style={{ borderTop: "1px solid #27272a" }}>
      <div className="max-w-6xl mx-auto">
        <div className="mb-12">
          <div className="text-xs font-mono uppercase tracking-wider mb-3" style={{ color: "#71717a" }}>
            Como funciona
          </div>
          <h2 className="font-bold text-2xl md:text-3xl tracking-tight" style={{ color: "#fafafa" }}>
            De la configuracion al primer email{" "}
            <span style={{ color: "#10b981" }}>en 5 minutos</span>
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {steps.map((step) => (
            <div
              key={step.num}
              className="p-5 rounded border transition-all hover:border-zinc-600"
              style={{ background: "#0c0c0e", borderColor: "#27272a" }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-9 h-9 rounded flex items-center justify-center"
                  style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}
                >
                  {step.icon}
                </div>
                <span className="font-mono text-xs" style={{ color: "#52525b" }}>
                  {step.num}
                </span>
              </div>
              <h3 className="font-semibold text-sm mb-2" style={{ color: "#fafafa" }}>
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: "#71717a" }}>
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Features ─────────────────────────────────────────────────────────────────

const features = [
  {
    icon: <IconWaveform />,
    title: "Analisis de audio completo",
    desc: "BPM, LUFS integrado, correlacion de fase, headroom y deteccion de tonalidad musical en segundos.",
  },
  {
    icon: <IconShield />,
    title: "Rechazo automatico",
    desc: "Reglas configurables que filtran demos fuera de standard. El productor recibe feedback tecnico inmediato.",
  },
  {
    icon: <IconFingerprint />,
    title: "Firma sonica personalizada",
    desc: "Cada sello define su perfil: rango de BPM, escala preferida, tolerancia de LUFS y criterios de rechazo.",
  },
  {
    icon: <IconFileAudio />,
    title: "WAV y FLAC",
    desc: "Soporte nativo para archivos sin perdida. Conversion automatica a stream ligero para el dashboard.",
  },
  {
    icon: <IconTemplates />,
    title: "Plantillas de email",
    desc: "Templates pre-armados para rechazo, aprobacion y seguimiento. Variables auto-rellenadas desde el track.",
  },
  {
    icon: <IconMail />,
    title: "CRM integrado",
    desc: "Mini CRM de contactos: ves quien fue aprobado o rechazado, historial de emails y estado de cada productor.",
  },
];

function Features() {
  return (
    <section id="features" className="py-20 px-6" style={{ borderTop: "1px solid #27272a" }}>
      <div className="max-w-6xl mx-auto">
        <div className="mb-12">
          <div className="text-xs font-mono uppercase tracking-wider mb-3" style={{ color: "#71717a" }}>
            Funcionalidades
          </div>
          <h2 className="font-bold text-2xl md:text-3xl tracking-tight" style={{ color: "#fafafa" }}>
            Todo lo que tu sello necesita,{" "}
            <span style={{ color: "#10b981" }}>nada que no</span>
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <div
              key={i}
              className="p-5 rounded border transition-all hover:border-zinc-600"
              style={{ background: "#0c0c0e", borderColor: "#27272a" }}
            >
              <div
                className="w-9 h-9 rounded flex items-center justify-center mb-4"
                style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}
              >
                {f.icon}
              </div>
              <h3 className="font-semibold text-sm mb-2" style={{ color: "#fafafa" }}>
                {f.title}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: "#71717a" }}>
                {f.desc}
              </p>
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
  return (
    <section id="pricing" className="py-20 px-6" style={{ borderTop: "1px solid #27272a" }}>
      <div className="max-w-3xl mx-auto">
        <div className="mb-12 text-center">
          <div className="text-xs font-mono uppercase tracking-wider mb-3" style={{ color: "#71717a" }}>
            Precios
          </div>
          <h2 className="font-bold text-2xl md:text-3xl tracking-tight" style={{ color: "#fafafa" }}>
            Simple. <span style={{ color: "#10b981" }}>Sin sorpresas.</span>
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Starter */}
          <div className="p-6 rounded border" style={{ background: "#0c0c0e", borderColor: "#27272a" }}>
            <div className="flex items-baseline justify-between mb-6">
              <span className="text-xs font-mono uppercase tracking-wider" style={{ color: "#71717a" }}>
                Starter
              </span>
              <div className="flex items-baseline gap-1">
                <span className="font-bold text-3xl" style={{ color: "#fafafa" }}>US$29</span>
                <span className="text-xs" style={{ color: "#71717a" }}>/mes</span>
              </div>
            </div>

            <ul className="space-y-3 mb-8">
              {[
                "Hasta 50 demos por mes",
                "1 firma sonica personalizada",
                "Analisis tecnico completo",
                "Dashboard basico",
                "CRM de emails con plantillas",
                "Feedback automatico para rechazos",
              ].map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm" style={{ color: "#71717a" }}>
                  <span style={{ color: "#10b981", flexShrink: 0, marginTop: "2px" }}>
                    <IconCheck />
                  </span>
                  {f}
                </li>
              ))}
            </ul>

            <a
              href={checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2.5 text-sm font-medium rounded transition-all hover:opacity-90 block text-center cursor-pointer"
              style={{ border: "1px solid #27272a", color: "#fafafa" }}
            >
              Empezar ahora
            </a>
          </div>

          {/* Pro */}
          <div className="p-6 rounded border" style={{ background: "#0c0c0e", borderColor: "#10b981" }}>
            <div className="flex items-baseline justify-between mb-6">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono uppercase tracking-wider" style={{ color: "#71717a" }}>
                  Pro
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}>
                  Popular
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="font-bold text-3xl" style={{ color: "#fafafa" }}>US$79</span>
                <span className="text-xs" style={{ color: "#71717a" }}>/mes</span>
              </div>
            </div>

            <ul className="space-y-3 mb-8">
              {[
                "Demos ilimitados",
                "Hasta 5 firmas sonicas",
                "Analisis avanzado + deteccion de samples",
                "Dashboard completo + export CSV",
                "CRM avanzado + plantillas custom",
                "API para integrar con tu DAW",
                "Soporte prioritario",
              ].map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm" style={{ color: "#71717a" }}>
                  <span style={{ color: "#10b981", flexShrink: 0, marginTop: "2px" }}>
                    <IconCheck />
                  </span>
                  {f}
                </li>
              ))}
            </ul>

            <a
              href={checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2.5 text-sm font-medium rounded transition-all hover:opacity-90 block text-center cursor-pointer"
              style={{ background: "#10b981", color: "#09090b" }}
            >
              Empezar ahora
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="py-8 px-6" style={{ borderTop: "1px solid #27272a" }}>
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <img src="/logo.png" alt="True Peak AI" className="h-8 w-auto" />

        <div className="text-xs" style={{ color: "#71717a" }}>
          &copy; 2026 True Peak AI. Hecho con cabeza en Buenos Aires.
        </div>

        <div className="flex items-center gap-6 text-xs" style={{ color: "#71717a" }}>
          <Link href="/login" className="cursor-pointer" style={{ color: "#71717a" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#fafafa")} onMouseLeave={(e) => (e.currentTarget.style.color = "#71717a")}>
            Iniciar sesion
          </Link>
          <Link href="/register" className="cursor-pointer" style={{ color: "#71717a" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#fafafa")} onMouseLeave={(e) => (e.currentTarget.style.color = "#71717a")}>
            Registrarse
          </Link>
          <Link href="/terms-of-service" className="cursor-pointer" style={{ color: "#71717a" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#fafafa")} onMouseLeave={(e) => (e.currentTarget.style.color = "#71717a")}>
            Terminos
          </Link>
          <Link href="/privacy-policy" className="cursor-pointer" style={{ color: "#71717a" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#fafafa")} onMouseLeave={(e) => (e.currentTarget.style.color = "#71717a")}>
            Privacidad
          </Link>
        </div>
      </div>
    </footer>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <div className="min-h-screen" style={{ background: "#09090b", color: "#fafafa" }}>
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
