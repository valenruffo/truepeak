"use client";

import { useLanguage } from "@/lib/i18n";
import Link from "next/link";

export default function GuidePage() {
  const { t } = useLanguage();

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 md:px-6" style={{ color: "var(--text-primary)" }}>
      <h1 className="text-2xl font-bold mb-2">{t("guide.title")}</h1>
      <p className="text-sm text-muted mb-8">{t("guide.subtitle")}</p>

      {/* Paso 1 */}
      <div className="mb-8 p-5 rounded" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "#10b981", color: "#09090b" }}>1</span>
          <h2 className="text-lg font-semibold">{t("guide.step1.title")}</h2>
        </div>
        <p className="text-sm text-muted leading-relaxed">
          {t("guide.step1.desc")} <strong style={{ color: "#10b981" }}><Link href="/link">{t("dashboard.nav.link")}</Link></strong> {t("guide.step1.desc2")}
          <br /><br />
          {t("guide.step1.desc3")} <strong style={{ color: "#10b981" }}><Link href="/link">{t("dashboard.nav.link")}</Link></strong>.
        </p>
      </div>

      {/* Paso 2 */}
      <div className="mb-8 p-5 rounded" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "#10b981", color: "#09090b" }}>2</span>
          <h2 className="text-lg font-semibold">{t("guide.step2.title")}</h2>
        </div>
        <p className="text-sm text-muted leading-relaxed">
          {t("guide.step2.desc")} <strong style={{ color: "#10b981" }}><Link href="/config">{t("dashboard.nav.config")}</Link></strong> {t("guide.step2.desc2")}
        </p>
        <div className="mt-3 space-y-2 text-sm text-muted">
          <div className="flex gap-2"><span style={{ color: "#10b981" }}>▪</span><span><strong>{t("config.bpm_label")}:</strong> {t("guide.step2.bpm")}</span></div>
          <div className="flex gap-2"><span style={{ color: "#10b981" }}>▪</span><span><strong>{t("config.lufs_label")}:</strong> {t("guide.step2.lufs")}</span></div>
          <div className="flex gap-2"><span style={{ color: "#10b981" }}>▪</span><span><strong>{t("config.duration_label")}:</strong> {t("guide.step2.duration")}</span></div>
          <div className="flex gap-2"><span style={{ color: "#10b981" }}>▪</span><span><strong>{t("config.scales_label")}:</strong> {t("guide.step2.scales")}</span></div>
          <div className="flex gap-2"><span style={{ color: "#10b981" }}>▪</span><span><strong>{t("config.auto_reject_label")}:</strong> {t("guide.step2.auto_reject")}</span></div>
        </div>
      </div>

      {/* Paso 3 */}
      <div className="mb-8 p-5 rounded" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "#10b981", color: "#09090b" }}>3</span>
          <h2 className="text-lg font-semibold">{t("guide.step3.title")}</h2>
        </div>
        <p className="text-sm text-muted leading-relaxed">
          {t("guide.step3.desc")} <strong style={{ color: "#10b981" }}><Link href="/inbox">{t("dashboard.nav.inbox")}</Link></strong> {t("guide.step3.desc2")}
          <br /><br />
          <strong>{t("guide.step3.pending")}</strong> {t("guide.step3.pending_desc")}<br />
          <strong>{t("guide.step3.approved")}</strong> {t("guide.step3.approved_desc")}<br />
          <strong>{t("guide.step3.rejected")}</strong> {t("guide.step3.rejected_desc")}<br /><br />
          {t("guide.step3.actions")}
        </p>
      </div>

      {/* Paso 4 */}
      <div className="mb-8 p-5 rounded" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "#10b981", color: "#09090b" }}>4</span>
          <h2 className="text-lg font-semibold">{t("guide.step4.title")}</h2>
        </div>
        <p className="text-sm text-muted leading-relaxed">
          {t("guide.step4.desc")} <strong style={{ color: "#10b981" }}><Link href="/crm">{t("dashboard.nav.crm")}</Link></strong> {t("guide.step4.desc2")}
          <br /><br />
          {t("guide.step4.desc3")} <strong>{t("guide.step4.desc4")}</strong> {t("guide.step4.desc5")} <strong>{t("guide.step4.desc6")}</strong>.
          <br /><br />
          {t("guide.step4.tip")}
        </p>
      </div>

      {/* Calidad de audio */}
      <div className="mb-8 p-5 rounded" style={{ background: "var(--bg-secondary)", border: "1px solid rgba(16,185,129,0.19)" }}>
        <h2 className="text-lg font-semibold mb-3" style={{ color: "#10b981" }}>{t("guide.audio.title")}</h2>
        <div className="space-y-2 text-sm text-muted">
          <div className="flex gap-2"><span style={{ color: "#10b981" }}>▪</span><span><strong>{t("guide.audio.player")}</strong></span></div>
          <div className="flex gap-2"><span style={{ color: "#10b981" }}>▪</span><span><strong>{t("guide.audio.download")}</strong></span></div>
          <div className="flex gap-2"><span style={{ color: "#10b981" }}>▪</span><span><strong>{t("guide.audio.storage")}</strong></span></div>
        </div>
      </div>

      {/* Glosario */}
      <div className="p-5 rounded" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <h2 className="text-lg font-semibold mb-3">{t("guide.glossary.title")}</h2>
        <div className="space-y-3 text-sm text-muted">
          <div><strong style={{ color: "var(--text-primary)" }}>{t("guide.glossary.bpm")}</strong></div>
          <div><strong style={{ color: "var(--text-primary)" }}>{t("guide.glossary.lufs")}</strong></div>
          <div><strong style={{ color: "var(--text-primary)" }}>{t("guide.glossary.phase")}</strong></div>
          <div><strong style={{ color: "var(--text-primary)" }}>{t("guide.glossary.key")}</strong></div>
          <div><strong style={{ color: "var(--text-primary)" }}>{t("guide.glossary.duration")}</strong></div>
        </div>
      </div>
    </div>
  );
}
