"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PlayerProvider, usePlayer, type PlayerTrack } from "@/lib/PlayerContext";
import WhatsAppBubble from "@/components/WhatsAppBubble";
import { useLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Music, Clock, AlertTriangle } from "lucide-react";

function PlayerBar() {
  const { currentTrack, isPlaying, progress, duration, volume, hasTracks, togglePlay, prevTrack, nextTrack, setVolume, seekTo, formatTime, audioRef } = usePlayer();

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo((e.clientX - rect.left) / rect.width);
  };

  if (!hasTracks || !currentTrack) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center gap-2 md:gap-4 px-2 md:px-4 md:ml-[240px]"
      style={{
        height: "64px",
        background: "var(--bg-card)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <button onClick={prevTrack} className="p-1.5 rounded transition-colors hover:bg-white/10" title="Anterior">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2">
          <polygon points="19 20 9 12 19 4 19 20" /><line x1="5" y1="19" x2="5" y2="5" />
        </svg>
      </button>

      <button onClick={togglePlay} className="p-2 rounded-full transition-colors hover:bg-white/10" title={isPlaying ? "Pausar" : "Reproducir"}>
        {isPlaying ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--text-primary)"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--text-primary)"><polygon points="5 3 19 12 5 21 5 3" /></svg>
        )}
      </button>

      <button onClick={nextTrack} className="p-1.5 rounded transition-colors hover:bg-white/10" title="Siguiente">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2">
          <polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" />
        </svg>
      </button>

      <div className="flex-1 h-1.5 rounded-full cursor-pointer group" style={{ background: "var(--border)" }} onClick={handleSeek}>
        <div className="h-full rounded-full transition-all duration-150 group-hover:h-2" style={{ width: `${progress}%`, background: "#10b981" }} />
      </div>

      <span className="text-[10px] font-mono text-muted whitespace-nowrap">
        {formatTime(audioRef.current?.currentTime ?? 0)} / {formatTime(duration)}
      </span>

      <div className="min-w-0 max-w-[200px]">
        <div className="text-xs font-medium truncate">{currentTrack.track_name}</div>
        <div className="text-[10px] text-muted truncate">{currentTrack.producer_name}</div>
      </div>

      <div className="flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          {volume > 0 && <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />}
          {volume > 0.5 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
        </svg>
        <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="w-16 h-1 accent-emerald-500" />
      </div>
    </div>
  );
}

function DashboardInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLanguage();
  const { toggleTheme } = useTheme();
  const [labelName, setLabelName] = useState<string>("");
  const [planInfo, setPlanInfo] = useState<string>("");
  const [plan, setPlan] = useState<string>("free");
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [hqCount, setHqCount] = useState<{ count: number; limit: number } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [monthlyUsed, setMonthlyUsed] = useState<number>(0);
  const [maxTracksMonth, setMaxTracksMonth] = useState<number>(10);
  const [mounted, setMounted] = useState(false);
  const { queueTracks } = usePlayer();

  useEffect(() => {
    setMounted(true);
    const slug = localStorage.getItem("slug");
    const token = localStorage.getItem("token");

    const fetchLabel = async () => {
      if (!slug) { setLabelName(""); setPlanInfo(""); return; }
      try {
        const res = await fetch(`/api/labels/${slug}`);
        if (res.ok) {
          const data = await res.json();
          setLabelName(data.name || slug);
          
          // Check for admin override
          const overridePlan = localStorage.getItem("admin_plan_override");
          if (overridePlan) {
            setPlanInfo(overridePlan.charAt(0).toUpperCase() + overridePlan.slice(1) + " (Override)");
            setPlan(overridePlan);
            localStorage.setItem("plan", overridePlan);
          } else {
            setPlanInfo(data.plan || "");
            setPlan(data.plan || "free");
            localStorage.setItem("plan", data.plan || "free");
          }
          
          setLogoPath(data.logo_path || null);
          setMaxTracksMonth(data.max_tracks_month || 10);
        } else { setLabelName(slug); setPlanInfo(""); }
      } catch { setLabelName(slug); setPlanInfo(""); }
    };
    fetchLabel();

    const fetchStats = async () => {
      if (!slug) return;
      try {
        const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`/api/labels/${slug}/stats`, {
          credentials: "include",
          headers: authHeaders,
        });
        if (res.ok) {
          const data = await res.json();
          setMonthlyUsed(data.total ?? 0);
        }
      } catch { /* silent */ }
    };
    fetchStats();

    const fetchHqCount = async () => {
      try {
        const hqHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`/api/labels/${slug}/hq-count`, {
          headers: hqHeaders,
        });
        if (res.ok) {
          const data = await res.json();
          setHqCount({ count: data.count, limit: data.limit });
        }
      } catch { /* silent */ }
    };
    if (slug) fetchHqCount();

    const fetchTracks = async () => {
      try {
        const res = await fetch(`/api/submissions?status=inbox&limit=100`, {
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data: PlayerTrack[] = await res.json();
          const withMp3 = data.filter((t) => t.mp3_path);
          queueTracks(withMp3);
        }
      } catch { /* silent */ }
    };
    fetchTracks();
  }, []);

  const navItems = [
    { href: "/config", label: t("dashboard.nav.config") },
    { href: "/link", label: t("dashboard.nav.link") },
    { href: "/inbox", label: t("dashboard.nav.inbox") },
    { href: "/crm", label: t("dashboard.nav.crm") },
    { href: "/guide", label: t("dashboard.nav.guide") },
  ];

  const labelInitial = labelName ? labelName.charAt(0).toUpperCase() : "?";

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}>
      {/* Mobile hamburger */}
      <button
        onClick={() => setSidebarOpen((p) => !p)}
        className="fixed top-3 left-3 z-50 md:hidden w-9 h-9 rounded flex items-center justify-center"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2">
          {sidebarOpen ? <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></> : <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>}
        </svg>
      </button>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 md:hidden" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full flex flex-col z-40 transition-transform ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}
        style={{ width: "240px", background: "var(--bg-card)", borderRight: "1px solid var(--border)" }}
      >
        <div className="px-5 pt-6 pb-4">
          <Link href="/"><img src="/logo.png" alt="True Peak AI" className="h-7 w-auto" /></Link>
        </div>

        {/* Label info with logo/avatar */}
        {labelName && (
          <div className="px-5 pb-3">
            <div style={{ borderBottom: "1px solid var(--border)" }} className="pb-3">
              <div className="flex items-center gap-3">
                {logoPath ? (
                  <img
                    src={`/logos/${logoPath}`}
                    alt={labelName}
                    className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                    style={{ border: "1px solid var(--border)" }}
                  />
                ) : (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
                    style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}
                  >
                    {labelInitial}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{labelName}</div>
                  {planInfo && <div className="text-[10px] text-muted mt-0.5">{planInfo}</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        <nav className="flex-1 px-3 pt-3">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}
                className={cn("block text-sm px-3 py-2 rounded transition-colors mb-0.5", isActive ? "font-medium" : "hover:bg-white/5")}
                style={{ color: isActive ? "#10b981" : "var(--text-secondary)", background: isActive ? "rgba(16,185,129,0.08)" : "transparent" }}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {plan === "free" && (
          <div className="px-3 mb-1 space-y-1">
            {monthlyUsed >= maxTracksMonth ? (
              <div className="px-3 py-1.5 rounded text-xs font-mono" style={{ background: "rgba(239,68,68,0.06)", color: "#ef4444" }}>
                {t("dashboard.no_tracks")} —{" "}
                <Link
                  href="/settings"
                  className="underline hover:opacity-80"
                  style={{ color: "#ef4444" }}
                >
                  {t("dashboard.upgrade")}
                </Link>
              </div>
            ) : maxTracksMonth - monthlyUsed <= 3 ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono" style={{ background: "rgba(250,204,21,0.06)", color: "#facc15" }}>
                <AlertTriangle className="w-3.5 h-3.5" /> Te quedan {maxTracksMonth - monthlyUsed} tracks
              </div>
            ) : null}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono" style={{ background: "rgba(16,185,129,0.06)", color: "var(--text-muted)" }}>
              <Music className="w-3.5 h-3.5" /> {monthlyUsed}/{maxTracksMonth} tracks este mes
            </div>
          </div>
        )}
        {plan === "indie" && (
          <div className="px-3 mb-1">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono text-emerald-500" style={{ background: "rgba(16,185,129,0.06)" }}>
              <Clock className="w-3.5 h-3.5" /> HQ guardados por 7 días
            </div>
          </div>
        )}
        {plan === "pro" && (
          <div className="px-3 mb-1">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono text-emerald-500" style={{ background: "rgba(16,185,129,0.06)" }}>
              <Clock className="w-3.5 h-3.5" /> HQ guardados por 14 días
            </div>
          </div>
        )}

        {/* Admin Plan Switcher (Localhost or VPS IP) */}
        {mounted && (
          window.location.hostname === "localhost" || 
          window.location.hostname === "127.0.0.1" || 
          window.location.hostname === "164.152.194.196"
        ) && (
          <div className="px-3 mb-3 mt-4 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
            <div className="text-[10px] font-mono uppercase tracking-widest text-emerald-500 mb-2 px-3">Admin Plan Switcher</div>
            <div className="flex flex-col gap-1 px-1">
              {["free", "indie", "pro"].map((p) => (
                <button
                  key={p}
                  onClick={async () => {
                    localStorage.setItem("admin_plan_override", p);
                    localStorage.setItem("plan", p);
                    
                    // Also update in DB so backend limits sync up
                    const slug = localStorage.getItem("slug");
                    try {
                      await fetch(`/api/labels/${slug}/plan`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ plan: p }),
                        credentials: "include"
                      });
                    } catch (err) {
                      console.error("Failed to sync plan to DB:", err);
                    }

                    setPlan(p);
                    setPlanInfo(p.charAt(0).toUpperCase() + p.slice(1) + " (Override)");
                    // Force reload to update all contexts and sub-pages
                    window.location.reload();
                  }}
                  className={cn(
                    "text-[10px] px-3 py-1.5 rounded font-mono uppercase transition-all",
                    plan === p 
                      ? "bg-emerald-500 text-black font-bold shadow-[0_0_10px_rgba(16,185,129,0.3)]" 
                      : "text-muted hover:bg-white/5"
                  )}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => {
                  localStorage.removeItem("admin_plan_override");
                  window.location.reload();
                }}
                className="text-[10px] px-3 py-1.5 rounded font-mono uppercase transition-all text-red-500 hover:bg-red-500/10 mt-1"
              >
                Reset to DB
              </button>
            </div>
          </div>
        )}

        {/* Bottom area: Settings + Logout */}
        <div className="px-3 pb-5">
          <Link
            href="/settings"
            onClick={() => setSidebarOpen(false)}
            className="block text-sm px-3 py-2 rounded transition-colors hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            {t("dashboard.nav.settings")}
          </Link>
          <button
            onClick={() => {
              localStorage.removeItem("slug");
              localStorage.removeItem("label_id");
              localStorage.removeItem("plan");
              localStorage.removeItem("token");
              fetch(`/api/labels/logout`, { method: "POST", credentials: "include" }).catch(() => {});
              router.push("/");
            }}
            className="w-full text-left text-sm px-3 py-2 rounded transition-colors hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
          >
            {t("dashboard.logout")}
          </button>
        </div>
      </aside>

      <main className="flex-1 pt-12 md:pt-0" style={{ marginLeft: "0", paddingBottom: "80px" }}>
        <div className="mx-auto max-w-6xl px-3 md:px-6 py-4 md:py-8 md:ml-[240px]">{children}</div>
      </main>

      <PlayerBar />
      <WhatsAppBubble />
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlayerProvider>
      <DashboardInner>{children}</DashboardInner>
    </PlayerProvider>
  );
}
