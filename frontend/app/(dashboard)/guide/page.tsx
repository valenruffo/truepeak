"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/lib/i18n";
import Link from "next/link";
import { getCache, setCache } from "@/lib/cache";

export default function GuidePage() {
  const { lang, t } = useLanguage();
  const [activeTab, setActiveTab] = useState<"workflow" | "rules" | "simulator" | "glossary">("workflow");

  // Simulator State
  const [bpmMin, setBpmMin] = useState(120);
  const [bpmMax, setBpmMax] = useState(126);
  const [lufsTarget, setLufsTarget] = useState(-14);
  const [lufsTolerance, setLufsTolerance] = useState(2.0);
  const [rejectPhase, setRejectPhase] = useState(true);
  const [rejectClipping, setRejectClipping] = useState(true);
  const [rejectLowDynamics, setRejectLowDynamics] = useState(true);

  const [peakLimitMax, setPeakLimitMax] = useState(0.0);
  const [peakLimitCritical, setPeakLimitCritical] = useState(1.5);
  const [crestFactorMin, setCrestFactorMin] = useState(5.0);
  const [crestFactorCritical, setCrestFactorCritical] = useState(3.5);
  const [phaseCorrelationMin, setPhaseCorrelationMin] = useState(0.3);
  const [phaseCorrelationCritical, setPhaseCorrelationCritical] = useState(0.0);

  const [trackBpm, setTrackBpm] = useState(126.5);
  const [trackLufs, setTrackLufs] = useState(-11.5);
  const [trackPhase, setTrackPhase] = useState(0.8);
  const [trackPeak, setTrackPeak] = useState(0.2); // DBFS peak
  const [trackCrestFactor, setTrackCrestFactor] = useState(6.5);

  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    const fetchConfig = async () => {
      const slug = localStorage.getItem("slug");
      if (!slug) { setFetching(false); return; }
      
      const cached = getCache<any>("tp_link_label_info", null);
      if (cached && cached.sonic_signature) {
        initializeSimulator(cached.sonic_signature);
      }
      
      try {
        const res = await fetch(`/api/labels/${slug}`);
        if (res.ok) {
          const data = await res.json();
          initializeSimulator(data.sonic_signature);
          setCache("tp_link_label_info", data);
        }
      } catch (e) {
        console.error("Error fetching config in guide page:", e);
      } finally {
        setFetching(false);
      }
    };
    fetchConfig();
  }, []);

  const initializeSimulator = (sig: any) => {
    if (!sig) return;
    if (sig.bpm_min !== undefined) setBpmMin(sig.bpm_min);
    if (sig.bpm_max !== undefined) setBpmMax(sig.bpm_max);
    if (sig.lufs_target !== undefined) setLufsTarget(sig.lufs_target);
    if (sig.lufs_tolerance !== undefined) setLufsTolerance(sig.lufs_tolerance);
    if (sig.auto_reject_rules) {
      if (sig.auto_reject_rules.phase !== undefined) setRejectPhase(sig.auto_reject_rules.phase);
      if (sig.auto_reject_rules.reject_clipping !== undefined) setRejectClipping(sig.auto_reject_rules.reject_clipping);
      if (sig.auto_reject_rules.reject_low_dynamic_range !== undefined) setRejectLowDynamics(sig.auto_reject_rules.reject_low_dynamic_range);
    }
    if (sig.peak_limit_max !== undefined) setPeakLimitMax(sig.peak_limit_max);
    if (sig.peak_limit_critical !== undefined) setPeakLimitCritical(sig.peak_limit_critical);
    if (sig.crest_factor_min !== undefined) setCrestFactorMin(sig.crest_factor_min);
    if (sig.crest_factor_critical !== undefined) setCrestFactorCritical(sig.crest_factor_critical);
    if (sig.phase_correlation_min !== undefined) setPhaseCorrelationMin(sig.phase_correlation_min);
    if (sig.phase_correlation_critical !== undefined) setPhaseCorrelationCritical(sig.phase_correlation_critical);
  };

  // Translation Helpers
  const esText = {
    title: "Guía de True Peak AI",
    subtitle: "Entendé la matemática detrás del filtrado y simulá tu Firma Sónica en tiempo real.",
    tabWorkflow: "Flujo de Trabajo",
    tabRules: "Criterios Técnicos",
    tabSimulator: "Simulador de Filtros",
    tabGlossary: "Glosario",
    
    // Technical Section
    rulesTitle: "Matemática y Criterios del Filtro",
    rulesDesc: "True Peak AI analiza el audio a nivel científico. Acá tenés las fórmulas exactas y reglas que determinan si un track se aprueba o se auto-rechaza:",
    ruleBpmTitle: "1. Tempo (BPM)",
    ruleBpmDesc: "El BPM del track se detecta como un valor decimal y se redondea al número entero más cercano antes de la verificación.",
    ruleBpmExample: "Si tu límite máximo es 126 BPM:\n• Un track detectado con 126.4 BPM se redondea a 126 (APROBADO).\n• Un track detectado con 126.5 BPM se redondea a 127 (AUTO-RECHAZADO).",
    
    ruleLufsTitle: "2. Volumen Integrado (LUFS)",
    ruleLufsDesc: "El volumen máximo permitido se calcula sumando la Tolerancia al Objetivo (Loudness Max = Target + Tolerance).",
    ruleLufsExample: "Si tu Target es -14 LUFS y la Tolerancia es 2.0 dB:\n• El volumen máximo permitido es -12 LUFS (ej. -13 LUFS es APROBADO).\n• Si el track mide -11.5 LUFS, suena demasiado fuerte (AUTO-RECHAZADO por volumen excesivo).",
    
    rulePhaseTitle: "3. Correlación de Fase",
    rulePhaseDesc: "Mide la compatibilidad estéreo de la mezcla (valores entre 1.0 y -1.0).",
    rulePhaseExample: "Si el filtro de Fase está activo:\n• Un track con correlación menor o igual a 0.0 se AUTO-RECHAZA.\n• ¿Por qué? Valores negativos indican fase invertida, lo que causará que la música desaparezca en sistemas de sonido mono (clubs, teléfonos).",
    
    ruleClippingTitle: "4. Clipping Digital",
    ruleClippingDesc: "Busca picos que saturen digitalmente (True Peak >= 0.99 dBFS).",
    ruleClippingExample: "Si está activo, detecta si el máster fue mal limitado y tiene distorsión digital. Si supera 0.99, se AUTO-RECHAZA.",
    
    ruleDynamicsTitle: "5. Crest Factor (Rango Dinámico)",
    ruleDynamicsDesc: "Mide la diferencia (en dB) entre los picos de volumen y la energía promedio del tema.",
    ruleDynamicsExample: "Si está activo y el Crest Factor es menor a 5.0 dB, el track se AUTO-RECHAZA por estar hipercomprimido (efecto 'brickwall' o 'ladrillo' sin dinámica).",

    // Simulator Section
    simTitle: "Simulador Interactivo de Firma Sónica",
    simDesc: "Ajustá los parámetros de tu firma y las métricas de un track de prueba para entender cómo actúa el filtro de forma automática.",
    simSigSection: "1. Tu Firma Sónica (Configuración)",
    simTrackSection: "2. Métricas del Track (Simulación)",
    simResultSection: "Resultado de la Simulación",
    simBpmRange: "Rango de BPM permitido:",
    simLufsTarget: "LUFS Objetivo:",
    simLufsTol: "Tolerancia LUFS:",
    simFilterPhase: "Filtro de Fase Activo",
    simFilterClipping: "Filtro de Clipping Activo",
    simFilterDynamics: "Filtro de Rango Dinámico Activo",
    simTrackBpm: "BPM del Track:",
    simTrackLufs: "LUFS del Track:",
    simTrackPhase: "Correlación de Fase del Track:",
    simTrackPeak: "True Peak Máximo del Track:",
    simTrackCrest: "Crest Factor del Track:",
    simStatusApproved: "APROBADO",
    simStatusRejected: "AUTO-RECHAZADO",
    
    // Severity levels translations
    ruleSeverityTitle: "6. Niveles de Gravedad (Validación Técnica)",
    ruleSeverityDesc: "En lugar de un filtro estrictamente binario, las alertas se clasifican en tres niveles de gravedad:",
    ruleSeverityExample: "• ÓPTIMO: Todo el análisis cumple con los límites exigidos.\n• ADVERTENCIA (Warning): Se activa si el True Peak está entre 0.0dB y +1.5dB, o el Crest Factor está entre 3.8dB y 5.0dB. El track se sube a R2, se genera MP3 y se guarda en el Kanban con un badge amarillo.\n• CRÍTICO: Se activa si la fase correlación es menor a 0.0 o el True Peak supera +2.0dB. Si el Auto-Rechazo está habilitado se descarta automáticamente; de lo contrario, ingresa con advertencia roja.",
  };

  const enText = {
    title: "True Peak AI Guide",
    subtitle: "Understand the math behind the filtering and simulate your Sonic Signature in real time.",
    tabWorkflow: "Workflow",
    tabRules: "Technical Specs",
    tabSimulator: "Filter Simulator",
    tabGlossary: "Glossary",
    
    // Technical Section
    rulesTitle: "Filter Math & Criteria",
    rulesDesc: "True Peak AI analyzes audio at a scientific level. Here are the exact formulas and rules that determine whether a track is approved or auto-rejected:",
    ruleBpmTitle: "1. Tempo (BPM)",
    ruleBpmDesc: "The track's BPM is detected as a decimal value and rounded to the nearest integer before verification.",
    ruleBpmExample: "If your maximum limit is 126 BPM:\n• A track detected at 126.4 BPM rounds to 126 (APPROVED).\n• A track detected at 126.5 BPM rounds to 127 (AUTO-REJECTED).",
    
    ruleLufsTitle: "2. Integrated Loudness (LUFS)",
    ruleLufsDesc: "The maximum allowed volume is calculated by adding the Tolerance to the Target (Loudness Max = Target + Tolerance).",
    ruleLufsExample: "If your Target is -14 LUFS and Tolerance is 2.0 dB:\n• The maximum allowed volume is -12 LUFS (e.g. -13 LUFS is APPROVED).\n• If the track measures -11.5 LUFS, it is too loud (AUTO-REJECTED for excessive loudness).",
    
    rulePhaseTitle: "3. Phase Correlation",
    rulePhaseDesc: "Measures the stereo compatibility of the mix (values between 1.0 and -1.0).",
    rulePhaseExample: "If the Phase filter is active:\n• A track with correlation less than or equal to 0.0 is AUTO-REJECTED.\n• Why? Negative values indicate inverted phase, causing audio cancellation on mono sound systems (clubs, phones).",
    
    ruleClippingTitle: "4. Digital Clipping",
    ruleClippingDesc: "Looks for peaks that digitally saturate (True Peak >= 0.99 dBFS).",
    ruleClippingExample: "If active, it detects if the master was poorly limited and contains digital distortion. If it exceeds 0.99, it is AUTO-REJECTED.",
    
    ruleDynamicsTitle: "5. Crest Factor (Dynamic Range)",
    ruleDynamicsDesc: "Measures the difference (in dB) between peak levels and average energy.",
    ruleDynamicsExample: "If active and the Crest Factor is less than 5.0 dB, the track is AUTO-REJECTED for being hyper-compressed ('brickwall' effect with no dynamics).",

    // Simulator Section
    simTitle: "Interactive Sonic Signature Simulator",
    simDesc: "Adjust your signature settings and the metrics of a test track to see exactly how the automatic filter reacts.",
    simSigSection: "1. Your Sonic Signature (Config)",
    simTrackSection: "2. Track Metrics (Simulation)",
    simResultSection: "Simulation Result",
    simBpmRange: "Allowed BPM Range:",
    simLufsTarget: "LUFS Target:",
    simLufsTol: "LUFS Tolerance:",
    simFilterPhase: "Phase Filter Active",
    simFilterClipping: "Clipping Filter Active",
    simFilterDynamics: "Dynamic Range Filter Active",
    simTrackBpm: "Track BPM:",
    simTrackLufs: "Track LUFS:",
    simTrackPhase: "Track Phase Correlation:",
    simTrackPeak: "Track Max True Peak:",
    simTrackCrest: "Track Crest Factor:",
    simStatusApproved: "APPROVED",
    simStatusRejected: "AUTO-REJECTED",

    // Severity levels translations
    ruleSeverityTitle: "6. Severity Levels (Technical Validation)",
    ruleSeverityDesc: "Instead of a binary pass/fail verification, issues are classified into three severity levels:",
    ruleSeverityExample: "• OPTIMAL: The entire analysis complies with the required limits.\n• WARNING: Triggered when True Peak is between 0.0dB and +1.5dB, or Crest Factor is between 3.8dB and 5.0dB. The track is uploaded to R2, MP3 generated, and placed in the Kanban with a yellow warning badge.\n• CRITICAL: Triggered when phase correlation is less than 0.0 or True Peak exceeds +2.0dB. If Auto-Rejection is enabled, the track is discarded; otherwise, it is saved in the Kanban with a red critical error status.",
  };

  const text = lang === "es" ? esText : enText;

  // Simulator Logic
  const getSimulationResult = () => {
    const criticals: string[] = [];
    const warnings: string[] = [];

    // 1. BPM check (Critical)
    const roundedBpm = Math.round(trackBpm);
    if (roundedBpm < bpmMin || roundedBpm > bpmMax) {
      criticals.push(lang === "es"
        ? `BPM fuera de rango (${roundedBpm} BPM vs límite [${bpmMin} - ${bpmMax}])`
        : `BPM out of range (${roundedBpm} BPM vs limit [${bpmMin} - ${bpmMax}])`
      );
    }

    // 2. LUFS check (Critical)
    const lufsMax = lufsTarget + lufsTolerance;
    if (trackLufs > lufsMax) {
      criticals.push(lang === "es"
        ? `LUFS excesivo (${trackLufs} LUFS vs límite ${lufsMax.toFixed(1)} LUFS)`
        : `LUFS excessive (${trackLufs} LUFS vs limit ${lufsMax.toFixed(1)} LUFS)`
      );
    }

    // 3. Phase check (Warning vs Critical)
    if (trackPhase < phaseCorrelationCritical) {
      if (rejectPhase) {
        criticals.push(lang === "es"
          ? `Correlación de fase crítica (${trackPhase.toFixed(2)} vs límite crítico ${phaseCorrelationCritical.toFixed(2)})`
          : `Critical phase correlation (${trackPhase.toFixed(2)} vs critical limit ${phaseCorrelationCritical.toFixed(2)})`
        );
      } else {
        warnings.push(lang === "es"
          ? `Correlación de fase crítica bajo modo manual (${trackPhase.toFixed(2)} vs límite crítico ${phaseCorrelationCritical.toFixed(2)})`
          : `Critical phase correlation under manual mode (${trackPhase.toFixed(2)} vs critical limit ${phaseCorrelationCritical.toFixed(2)})`
        );
      }
    } else if (trackPhase < phaseCorrelationMin) {
      warnings.push(lang === "es"
        ? `Correlación de fase baja (${trackPhase.toFixed(2)} vs límite recomendado ${phaseCorrelationMin.toFixed(2)})`
        : `Low phase correlation (${trackPhase.toFixed(2)} vs recommended limit ${phaseCorrelationMin.toFixed(2)})`
      );
    }

    // 4. Clipping check (Warning vs Critical)
    if (trackPeak > peakLimitCritical) {
      if (rejectClipping) {
        criticals.push(lang === "es"
          ? `True Peak crítico (${trackPeak.toFixed(1)} dB vs límite crítico ${peakLimitCritical.toFixed(1)} dB)`
          : `Critical True Peak (${trackPeak.toFixed(1)} dB vs critical limit ${peakLimitCritical.toFixed(1)} dB)`
        );
      } else {
        warnings.push(lang === "es"
          ? `True Peak crítico bajo modo manual (${trackPeak.toFixed(1)} dB vs límite crítico ${peakLimitCritical.toFixed(1)} dB)`
          : `Critical True Peak under manual mode (${trackPeak.toFixed(1)} dB vs critical limit ${peakLimitCritical.toFixed(1)} dB)`
        );
      }
    } else if (trackPeak > peakLimitMax) {
      warnings.push(lang === "es"
        ? `True Peak elevado (${trackPeak.toFixed(1)} dB vs límite recomendado ${peakLimitMax.toFixed(1)} dB)`
        : `Elevated True Peak (${trackPeak.toFixed(1)} dB vs recommended limit ${peakLimitMax.toFixed(1)} dB)`
      );
    }

    // 5. Dynamics check (Warning vs Critical)
    if (trackCrestFactor < crestFactorCritical) {
      if (rejectLowDynamics) {
        criticals.push(lang === "es"
          ? `Crest Factor crítico (${trackCrestFactor.toFixed(1)} dB vs límite crítico ${crestFactorCritical.toFixed(1)} dB)`
          : `Critical Crest Factor (${trackCrestFactor.toFixed(1)} dB vs critical limit ${crestFactorCritical.toFixed(1)} dB)`
        );
      } else {
        warnings.push(lang === "es"
          ? `Crest Factor crítico bajo modo manual (${trackCrestFactor.toFixed(1)} dB vs límite crítico ${crestFactorCritical.toFixed(1)} dB)`
          : `Critical Crest Factor under manual mode (${trackCrestFactor.toFixed(1)} dB vs critical limit ${crestFactorCritical.toFixed(1)} dB)`
        );
      }
    } else if (trackCrestFactor < crestFactorMin) {
      warnings.push(lang === "es"
        ? `Crest Factor bajo (${trackCrestFactor.toFixed(1)} dB vs límite recomendado ${crestFactorMin.toFixed(1)} dB)`
        : `Low Crest Factor (${trackCrestFactor.toFixed(1)} dB vs recommended limit ${crestFactorMin.toFixed(1)} dB)`
      );
    }

    return { criticals, warnings };
  };

  const { criticals, warnings } = getSimulationResult();

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 md:px-6" style={{ color: "var(--text-primary)" }}>
      {/* Header */}
      <div className="relative mb-8 pb-4">
        <div className="absolute -top-10 left-10 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
        <h1 className="text-3xl font-bold tracking-tight mb-2 bg-gradient-to-r from-white via-zinc-200 to-zinc-500 bg-clip-text text-transparent">
          {text.title}
        </h1>
        <p className="text-sm text-muted">{text.subtitle}</p>
      </div>

      {/* Modern Tab Selector */}
      <div className="flex border-b border-zinc-800 gap-2 mb-8 overflow-x-auto pb-px">
        {(["workflow", "rules", "simulator", "glossary"] as const).map((tab) => {
          const tabLabel = {
            workflow: text.tabWorkflow,
            rules: text.tabRules,
            simulator: text.tabSimulator,
            glossary: text.tabGlossary,
          }[tab];
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap -mb-px ${
                active
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {tabLabel}
            </button>
          );
        })}
      </div>

      {/* Tab 1: Workflow */}
      {activeTab === "workflow" && (
        <div className="grid gap-6">
          {/* Step 1 */}
          <div className="p-6 rounded-lg transition-all hover:border-zinc-700/50" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-3 mb-3">
              <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/15">1</span>
              <h2 className="text-lg font-semibold">{t("guide.step1.title")}</h2>
            </div>
            <p className="text-sm text-zinc-400 leading-relaxed">
              {t("guide.step1.desc")} <strong className="text-emerald-400"><Link href="/link">{t("dashboard.nav.link")}</Link></strong> {t("guide.step1.desc2")}
              <br /><br />
              {t("guide.step1.desc3")} <strong className="text-emerald-400"><Link href="/link">{t("dashboard.nav.link")}</Link></strong>.
            </p>
          </div>

          {/* Step 2 */}
          <div className="p-6 rounded-lg transition-all hover:border-zinc-700/50" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-3 mb-3">
              <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/15">2</span>
              <h2 className="text-lg font-semibold">{t("guide.step2.title")}</h2>
            </div>
            <p className="text-sm text-zinc-400 leading-relaxed mb-4">
              {t("guide.step2.desc")} <strong className="text-emerald-400"><Link href="/config">{t("dashboard.nav.config")}</Link></strong> {t("guide.step2.desc2")}
            </p>
            <div className="grid md:grid-cols-2 gap-3 text-sm text-zinc-400">
              <div className="p-3 bg-zinc-900/30 rounded border border-zinc-800/40">
                <strong className="text-zinc-200 block mb-1">{t("config.bpm_label")}</strong>
                {t("guide.step2.bpm")}
              </div>
              <div className="p-3 bg-zinc-900/30 rounded border border-zinc-800/40">
                <strong className="text-zinc-200 block mb-1">{t("config.lufs_label")}</strong>
                {t("guide.step2.lufs")}
              </div>
              <div className="p-3 bg-zinc-900/30 rounded border border-zinc-800/40">
                <strong className="text-zinc-200 block mb-1">{t("config.duration_label")}</strong>
                {t("guide.step2.duration")}
              </div>
              <div className="p-3 bg-zinc-900/30 rounded border border-zinc-800/40">
                <strong className="text-zinc-200 block mb-1">{t("config.scales_label")}</strong>
                {t("guide.step2.scales")}
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="p-6 rounded-lg transition-all hover:border-zinc-700/50" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-3 mb-3">
              <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/15">3</span>
              <h2 className="text-lg font-semibold">{t("guide.step3.title")}</h2>
            </div>
            <p className="text-sm text-zinc-400 leading-relaxed mb-4">
              {t("guide.step3.desc")} <strong className="text-emerald-400"><Link href="/inbox">{t("dashboard.nav.inbox")}</Link></strong> {t("guide.step3.desc2")}
            </p>
            <div className="space-y-2 mb-4">
              <div className="flex items-start gap-2 text-sm">
                <span className="px-2 py-0.5 text-xs font-semibold rounded bg-cyan-500/10 text-cyan-400 mt-0.5">{t("guide.step3.pending")}</span>
                <span className="text-zinc-400">{t("guide.step3.pending_desc")}</span>
              </div>
              <div className="flex items-start gap-2 text-sm">
                <span className="px-2 py-0.5 text-xs font-semibold rounded bg-emerald-500/10 text-emerald-400 mt-0.5">{t("guide.step3.approved")}</span>
                <span className="text-zinc-400">{t("guide.step3.approved_desc")}</span>
              </div>
              <div className="flex items-start gap-2 text-sm">
                <span className="px-2 py-0.5 text-xs font-semibold rounded bg-rose-500/10 text-rose-400 mt-0.5">{t("guide.step3.rejected")}</span>
                <span className="text-zinc-400">{t("guide.step3.rejected_desc")}</span>
              </div>
            </div>
            <p className="text-xs text-zinc-500 italic">{t("guide.step3.actions")}</p>
          </div>

          {/* Step 4 */}
          <div className="p-6 rounded-lg transition-all hover:border-zinc-700/50" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-3 mb-3">
              <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/15">4</span>
              <h2 className="text-lg font-semibold">{t("guide.step4.title")}</h2>
            </div>
            <p className="text-sm text-zinc-400 leading-relaxed mb-2">
              {t("guide.step4.desc")} <strong className="text-emerald-400"><Link href="/crm">{t("dashboard.nav.crm")}</Link></strong> {t("guide.step4.desc2")}
            </p>
            <p className="text-sm text-zinc-400 leading-relaxed">
              {t("guide.step4.desc3")} <strong>{t("guide.step4.desc4")}</strong> {t("guide.step4.desc5")} <strong>{t("guide.step4.desc6")}</strong>.
            </p>
            <p className="text-xs text-emerald-400/80 mt-4 bg-emerald-500/5 px-3 py-2 rounded border border-emerald-500/10 inline-block">
              💡 {t("guide.step4.tip")}
            </p>
          </div>
        </div>
      )}

      {/* Tab 2: Rules */}
      {activeTab === "rules" && (
        <div className="space-y-6">
          <div className="p-6 rounded-lg" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <h2 className="text-xl font-semibold mb-2">{text.rulesTitle}</h2>
            <p className="text-sm text-zinc-400 mb-6">{text.rulesDesc}</p>
            
            <div className="space-y-6">
              {/* BPM Rule */}
              <div className="pb-6 border-b border-zinc-800/80">
                <h3 className="text-base font-semibold text-zinc-200 mb-2">{text.ruleBpmTitle}</h3>
                <p className="text-sm text-zinc-400 mb-3">{text.ruleBpmDesc}</p>
                <pre className="text-xs p-3 bg-zinc-950 rounded text-zinc-300 border border-zinc-800/40 whitespace-pre-line font-mono">
                  {text.ruleBpmExample}
                </pre>
              </div>

              {/* LUFS Rule */}
              <div className="pb-6 border-b border-zinc-800/80">
                <h3 className="text-base font-semibold text-zinc-200 mb-2">{text.ruleLufsTitle}</h3>
                <p className="text-sm text-zinc-400 mb-3">{text.ruleLufsDesc}</p>
                <pre className="text-xs p-3 bg-zinc-950 rounded text-zinc-300 border border-zinc-800/40 whitespace-pre-line font-mono">
                  {text.ruleLufsExample}
                </pre>
              </div>

              {/* Phase Rule */}
              <div className="pb-6 border-b border-zinc-800/80">
                <h3 className="text-base font-semibold text-zinc-200 mb-2">{text.rulePhaseTitle}</h3>
                <p className="text-sm text-zinc-400 mb-3">{text.rulePhaseDesc}</p>
                <pre className="text-xs p-3 bg-zinc-950 rounded text-zinc-300 border border-zinc-800/40 whitespace-pre-line font-mono">
                  {text.rulePhaseExample}
                </pre>
              </div>

              {/* Clipping Rule */}
              <div className="pb-6 border-b border-zinc-800/80">
                <h3 className="text-base font-semibold text-zinc-200 mb-2">{text.ruleClippingTitle}</h3>
                <p className="text-sm text-zinc-400 mb-3">{text.ruleClippingDesc}</p>
                <pre className="text-xs p-3 bg-zinc-950 rounded text-zinc-300 border border-zinc-800/40 whitespace-pre-line font-mono">
                  {text.ruleClippingExample}
                </pre>
              </div>

              {/* Dynamics Rule */}
              <div className="pb-6 border-b border-zinc-800/80">
                <h3 className="text-base font-semibold text-zinc-200 mb-2">{text.ruleDynamicsTitle}</h3>
                <p className="text-sm text-zinc-400 mb-3">{text.ruleDynamicsDesc}</p>
                <pre className="text-xs p-3 bg-zinc-950 rounded text-zinc-300 border border-zinc-800/40 whitespace-pre-line font-mono">
                  {text.ruleDynamicsExample}
                </pre>
              </div>

              {/* Severity Levels Rule */}
              <div>
                <h3 className="text-base font-semibold text-zinc-200 mb-2">{text.ruleSeverityTitle}</h3>
                <p className="text-sm text-zinc-400 mb-3">{text.ruleSeverityDesc}</p>
                <pre className="text-xs p-3 bg-zinc-950 rounded text-zinc-300 border border-zinc-800/40 whitespace-pre-line font-mono">
                  {text.ruleSeverityExample}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Simulator */}
      {activeTab === "simulator" && (
        <div className="grid md:grid-cols-5 gap-6">
          {/* Left Inputs (3 cols) */}
          <div className="md:col-span-3 space-y-6">
            {/* Signature configuration */}
            <div className="p-5 rounded-lg border border-zinc-800 bg-zinc-900/20">
              <h3 className="text-base font-semibold text-emerald-400 mb-4">{text.simSigSection}</h3>
              
              <div className="space-y-4">
                {/* BPM sliders */}
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">
                    {text.simBpmRange} <span className="text-zinc-200 font-mono font-semibold">{bpmMin} - {bpmMax} BPM</span>
                  </label>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <span className="text-[10px] text-zinc-500 block">Min</span>
                      <input
                        type="range"
                        min="70"
                        max="180"
                        value={bpmMin}
                        onChange={(e) => setBpmMin(parseInt(e.target.value))}
                        className="w-full accent-emerald-500"
                      />
                    </div>
                    <div className="flex-1">
                      <span className="text-[10px] text-zinc-500 block">Max</span>
                      <input
                        type="range"
                        min="70"
                        max="180"
                        value={bpmMax}
                        onChange={(e) => setBpmMax(Math.max(bpmMin + 1, parseInt(e.target.value)))}
                        className="w-full accent-emerald-500"
                      />
                    </div>
                  </div>
                </div>

                {/* LUFS parameters */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">
                      {text.simLufsTarget} <span className="text-zinc-200 font-mono font-semibold">{lufsTarget} LUFS</span>
                    </label>
                    <input
                      type="range"
                      min="-20"
                      max="-4"
                      value={lufsTarget}
                      onChange={(e) => setLufsTarget(parseInt(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">
                      {text.simLufsTol} <span className="text-zinc-200 font-mono font-semibold">+{lufsTolerance.toFixed(1)} dB</span>
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="5"
                      step="0.5"
                      value={lufsTolerance}
                      onChange={(e) => setLufsTolerance(parseFloat(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                </div>

                {/* True Peak thresholds slider */}
                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-zinc-800/40">
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">
                      {lang === "es" ? "Peak Max (Adv.):" : "Peak Max (Warn.):"} <span className="text-zinc-200 font-mono font-semibold">{peakLimitMax.toFixed(1)} dB</span>
                    </label>
                    <input
                      type="range"
                      min="-2.0"
                      max="0.0"
                      step="0.1"
                      value={peakLimitMax}
                      onChange={(e) => setPeakLimitMax(Math.min(+e.target.value, peakLimitCritical - 0.1))}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">
                      {lang === "es" ? "Peak Crítico (Rechazo):" : "Peak Critical (Reject):"} <span className="text-rose-400 font-mono font-semibold">{peakLimitCritical.toFixed(1)} dB</span>
                    </label>
                    <input
                      type="range"
                      min="0.0"
                      max="3.0"
                      step="0.1"
                      value={peakLimitCritical}
                      onChange={(e) => setPeakLimitCritical(Math.max(+e.target.value, peakLimitMax + 0.1))}
                      className="w-full accent-rose-500"
                    />
                  </div>
                </div>

                {/* Crest Factor thresholds slider */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">
                      {lang === "es" ? "Crest Min (Adv.):" : "Crest Min (Warn.):"} <span className="text-zinc-200 font-mono font-semibold">{crestFactorMin.toFixed(1)} dB</span>
                    </label>
                    <input
                      type="range"
                      min="4.0"
                      max="10.0"
                      step="0.1"
                      value={crestFactorMin}
                      onChange={(e) => setCrestFactorMin(Math.max(+e.target.value, crestFactorCritical + 0.1))}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">
                      {lang === "es" ? "Crest Crítico (Rechazo):" : "Crest Critical (Reject):"} <span className="text-rose-400 font-mono font-semibold">{crestFactorCritical.toFixed(1)} dB</span>
                    </label>
                    <input
                      type="range"
                      min="3.0"
                      max="6.0"
                      step="0.1"
                      value={crestFactorCritical}
                      onChange={(e) => setCrestFactorCritical(Math.min(+e.target.value, crestFactorMin - 0.1))}
                      className="w-full accent-rose-500"
                    />
                  </div>
                </div>

                {/* Phase Correlation thresholds slider */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">
                      {lang === "es" ? "Fase Min (Adv.):" : "Phase Min (Warn.):"} <span className="text-zinc-200 font-mono font-semibold">{phaseCorrelationMin.toFixed(2)}</span>
                    </label>
                    <input
                      type="range"
                      min="0.0"
                      max="0.5"
                      step="0.05"
                      value={phaseCorrelationMin}
                      onChange={(e) => setPhaseCorrelationMin(Math.max(+e.target.value, phaseCorrelationCritical + 0.01))}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">
                      {lang === "es" ? "Fase Crítica (Rechazo):" : "Phase Critical (Reject):"} <span className="text-rose-400 font-mono font-semibold">{phaseCorrelationCritical.toFixed(2)}</span>
                    </label>
                    <input
                      type="range"
                      min="-0.2"
                      max="0.2"
                      step="0.05"
                      value={phaseCorrelationCritical}
                      onChange={(e) => setPhaseCorrelationCritical(Math.min(+e.target.value, phaseCorrelationMin - 0.01))}
                      className="w-full accent-rose-500"
                    />
                  </div>
                </div>

                {/* Filters checkbox toggles */}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-zinc-800/60">
                  <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rejectPhase}
                      onChange={(e) => setRejectPhase(e.target.checked)}
                      className="rounded accent-emerald-500"
                    />
                    <span>Fase</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rejectClipping}
                      onChange={(e) => setRejectClipping(e.target.checked)}
                      className="rounded accent-emerald-500"
                    />
                    <span>Clipping</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rejectLowDynamics}
                      onChange={(e) => setRejectLowDynamics(e.target.checked)}
                      className="rounded accent-emerald-500"
                    />
                    <span>Dinámica</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Track metrics simulation inputs */}
            <div className="p-5 rounded-lg border border-zinc-800 bg-zinc-900/20">
              <h3 className="text-base font-semibold text-emerald-400 mb-4">{text.simTrackSection}</h3>
              
              <div className="space-y-4">
                {/* Track BPM */}
                <div>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>{text.simTrackBpm}</span>
                    <span className="text-zinc-200 font-mono font-semibold">{trackBpm} BPM (Redondea a: {Math.round(trackBpm)})</span>
                  </div>
                  <input
                    type="range"
                    min="70"
                    max="180"
                    step="0.1"
                    value={trackBpm}
                    onChange={(e) => setTrackBpm(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>

                {/* Track LUFS */}
                <div>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>{text.simTrackLufs}</span>
                    <span className="text-zinc-200 font-mono font-semibold">{trackLufs} LUFS</span>
                  </div>
                  <input
                    type="range"
                    min="-22"
                    max="-3"
                    step="0.1"
                    value={trackLufs}
                    onChange={(e) => setTrackLufs(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>

                {/* Track Phase Correlation */}
                <div>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>{text.simTrackPhase}</span>
                    <span className={`font-mono font-semibold ${
                      trackPhase < phaseCorrelationCritical ? "text-rose-400" : trackPhase < phaseCorrelationMin ? "text-amber-400" : "text-emerald-400"
                    }`}>{trackPhase.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="-1"
                    max="1"
                    step="0.05"
                    value={trackPhase}
                    onChange={(e) => setTrackPhase(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>

                {/* Track True Peak */}
                <div>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>{text.simTrackPeak}</span>
                    <span className={`font-mono font-semibold ${
                      trackPeak > peakLimitCritical ? "text-rose-400" : trackPeak > peakLimitMax ? "text-amber-400" : "text-emerald-400"
                    }`}>{trackPeak.toFixed(1)} dBFS</span>
                  </div>
                  <input
                    type="range"
                    min="-3.0"
                    max="4.0"
                    step="0.1"
                    value={trackPeak}
                    onChange={(e) => setTrackPeak(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>

                {/* Track Crest Factor */}
                <div>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>{text.simTrackCrest}</span>
                    <span className={`font-mono font-semibold ${
                      trackCrestFactor < crestFactorCritical ? "text-rose-400" : trackCrestFactor < crestFactorMin ? "text-amber-400" : "text-emerald-400"
                    }`}>{trackCrestFactor.toFixed(1)} dB</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="12"
                    step="0.1"
                    value={trackCrestFactor}
                    onChange={(e) => setTrackCrestFactor(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right Result Panel (2 cols) */}
          <div className="md:col-span-2">
            <div className="sticky top-6 p-5 rounded-lg border flex flex-col h-full justify-between gap-6" style={{
              background: "var(--bg-secondary)",
              borderColor: criticals.length > 0 ? "rgba(239,68,68,0.25)" : warnings.length > 0 ? "rgba(245,158,11,0.25)" : "rgba(16,185,129,0.25)"
            }}>
              <div>
                <h3 className="text-sm font-semibold text-zinc-400 mb-4">{text.simResultSection}</h3>
                
                {/* Visual state badge */}
                <div className={`py-4 px-6 rounded-md text-center font-bold text-lg mb-4 flex flex-col gap-1 items-center justify-center transition-all ${
                  criticals.length > 0 
                    ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" 
                    : warnings.length > 0
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                }`}>
                  {criticals.length > 0 ? (
                    <>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mb-1 animate-bounce">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      {text.simStatusRejected} ({criticals.length} {criticals.length === 1 ? (lang === "es" ? "crítico" : "critical") : (lang === "es" ? "críticos" : "criticals")})
                    </>
                  ) : warnings.length > 0 ? (
                    <>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mb-1">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      {lang === "es" ? "APROBADO CON ALERTAS" : "APPROVED WITH ALERTS"} ({warnings.length} {warnings.length === 1 ? (lang === "es" ? "alerta" : "alert") : (lang === "es" ? "alertas" : "alerts")})
                    </>
                  ) : (
                    <>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mb-1">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {lang === "es" ? "APROBADO (ÓPTIMO)" : "APPROVED (OPTIMAL)"}
                    </>
                  )}
                </div>

                {/* Explanation text */}
                <div className="text-sm text-zinc-300 leading-relaxed bg-zinc-950/40 p-4 rounded border border-zinc-800/40 space-y-3">
                  {criticals.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-rose-400 uppercase tracking-wider mb-1">
                        {lang === "es" ? "Errores Críticos:" : "Critical Errors:"}
                      </h4>
                      <ul className="list-disc list-inside space-y-1 text-xs text-rose-300/95 pl-1 font-sans">
                        {criticals.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    </div>
                  )}
                  {warnings.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-1">
                        {lang === "es" ? "Advertencias:" : "Warnings:"}
                      </h4>
                      <ul className="list-disc list-inside space-y-1 text-xs text-amber-300/95 pl-1 font-sans">
                        {warnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  )}
                  {criticals.length === 0 && warnings.length === 0 && (
                    <p className="text-xs text-emerald-400 font-medium">
                      {lang === "es" 
                        ? "¡Excelente! El track cumple con todas las directrices óptimas de tu firma sónica."
                        : "Excellent! The track complies with all optimal guidelines of your sonic signature."}
                    </p>
                  )}
                </div>
              </div>

              {/* Tips for fine tuning */}
              <div className="text-xs text-zinc-500 bg-zinc-950/20 p-3 rounded">
                💡 <strong>Dato:</strong> Los sellos suelen usar un rango de 120-128 BPM y volumen -12 a -14 LUFS para mantener un balance ideal en su catálogo.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Glossary */}
      {activeTab === "glossary" && (
        <div className="p-6 rounded-lg" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <h2 className="text-xl font-semibold mb-4">{t("guide.glossary.title")}</h2>
          <div className="space-y-4 text-sm text-zinc-400">
            <div className="pb-4 border-b border-zinc-800/60">
              <strong className="text-zinc-200 block mb-1">{t("guide.glossary.bpm")}</strong>
              <span>Beats Por Minuto. Mide la velocidad del tempo de un track.</span>
            </div>
            <div className="pb-4 border-b border-zinc-800/60">
              <strong className="text-zinc-200 block mb-1">{t("guide.glossary.lufs")}</strong>
              <span>Loudness Units Full Scale. Mide el volumen integrado percibido por el oído humano. Spotify normaliza a -14 LUFS; los clubes apuntan a masters de -6 a -8 LUFS.</span>
            </div>
            <div className="pb-4 border-b border-zinc-800/60">
              <strong className="text-zinc-200 block mb-1">{t("guide.glossary.phase")}</strong>
              <span>Correlación de fase. Mide la fase entre el canal izquierdo y derecho. Si la señal está totalmente invertida (-1.0), los dos canales se cancelan mutuamente en sistemas mono.</span>
            </div>
            <div>
              <strong className="text-zinc-200 block mb-1">{t("guide.glossary.key")}</strong>
              <span>Clave o tonalidad musical (ej: 8A, 1A, C minor). Indispensable para realizar mezclas armónicas consistentes.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
