"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { PlayerProvider, usePlayer, type PlayerTrack } from "@/lib/PlayerContext";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { useLanguage } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Music, Clock, AlertTriangle, Sliders, Link2, Inbox, Mail, BookOpen, Settings, LogOut, Bell } from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import { supabase } from "@/lib/supabase";
import { SWRProvider } from "@/lib/swr-config";
import { useLabelStore, type LabelConfig } from "@/store/label";
import { getNotifications, markNotificationsAsRead, type Notification } from "@/lib/api";

function PlayerBar() {
  const { currentTrack, isPlaying, progress, duration, volume, hasTracks, togglePlay, prevTrack, nextTrack, setVolume, seekTo, formatTime, audioRef } = usePlayer();
  const wsRef = useRef<WaveSurfer | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const [loadedTrackId, setLoadedTrackId] = useState<string | null>(null);
  const [hoverWidth, setHoverWidth] = useState<string>("0%");
  const [isHovering, setIsHovering] = useState(false);
  const isInitializingRef = useRef<string | null>(null);
  const durationRef = useRef(duration);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  // Reset loadedTrackId on unmount or track change
  const isCurrentlyLoading = !currentTrack?.id || currentTrack.id !== loadedTrackId;

  useEffect(() => {
    if (!waveformRef.current || !currentTrack?.id || !audioRef.current) {
      if (wsRef.current) {
        wsRef.current.destroy();
        wsRef.current = null;
      }
      isInitializingRef.current = null;
      return;
    }

    const trackId = currentTrack.id;
    if (isInitializingRef.current === trackId) return;

    isInitializingRef.current = trackId;

    const loadAndCreate = async () => {
      let peaksData: number[] | undefined = undefined;
      let trackDuration: number | undefined = undefined;
      
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || "";
        
        const res = await fetch(`/api/submissions/${trackId}/peaks`, {
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          if (data.peaks && data.peaks.length > 0) {
            peaksData = data.peaks;
          }
          if (data.duration) {
            trackDuration = data.duration;
          }
        }
      } catch (err) {
        console.error("Error loading peaks:", err);
      }

      // Check if we are still initializing this track
      if (isInitializingRef.current !== trackId || !waveformRef.current) return;

      // Clean up any stale instances just in case before creating
      if (wsRef.current) {
        wsRef.current.destroy();
        wsRef.current = null;
      }

      const newWs = WaveSurfer.create({
        container: waveformRef.current,
        media: audioRef.current!, // Automatically syncs progress, playback, and seeks!
        waveColor: "#27272a",
        progressColor: "#10b981",
        cursorColor: "#10b981",
        cursorWidth: 1,
        height: 64,
        barWidth: 1,
        barGap: 0,
        barRadius: 0,
        normalize: false,
        peaks: peaksData ? [peaksData] : undefined,
        duration: trackDuration || durationRef.current || undefined,
      });

      // Show the waveform and hide the loading state
      setLoadedTrackId(trackId);

      newWs.on("error", () => {
        setLoadedTrackId(trackId);
      });

      wsRef.current = newWs;
      isInitializingRef.current = null;
    };

    loadAndCreate();

    return () => {
      if (wsRef.current) {
        wsRef.current.destroy();
        wsRef.current = null;
      }
      isInitializingRef.current = null;
    };
  }, [currentTrack?.id, audioRef]);

  if (!hasTracks || !currentTrack) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-30 flex items-center gap-2 md:gap-4 px-2 md:px-4 md:ml-[200px]"
      style={{
        height: "80px",
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

      {/* WaveSurfer waveform container */}
      <div
        className="flex-1 relative group"
        style={{ height: "64px", minWidth: 0 }}
        onPointerMove={(e) => {
          if (isCurrentlyLoading) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
          setHoverWidth(`${pct}%`);
        }}
        onPointerEnter={() => {
          if (!isCurrentlyLoading) setIsHovering(true);
        }}
        onPointerLeave={() => {
          setIsHovering(false);
          setHoverWidth("0%");
        }}
      >
        {/* Actual WaveSurfer div */}
        <div
          ref={waveformRef}
          style={{
            width: "100%",
            height: "100%",
            cursor: "pointer",
            opacity: !isCurrentlyLoading ? 1 : 0,
            transition: "opacity 0.2s ease-in-out",
          }}
        />

        {/* SoundCloud-style Hover Progress Overlay */}
        {isHovering && !isCurrentlyLoading && (
          <div
            className="absolute top-0 bottom-0 left-0 pointer-events-none border-r border-[#10b981]/40"
            style={{
              width: hoverWidth,
              background: "rgba(16, 185, 129, 0.12)",
              zIndex: 10,
            }}
          />
        )}

        {/* Loading/Static Placeholder Waveform */}
        {isCurrentlyLoading && (
          <div
            className="absolute inset-0 flex items-center gap-[1px] pointer-events-none overflow-hidden justify-start z-20"
            style={{ backgroundColor: "var(--bg-card)" }}
          >
            {Array.from({ length: 480 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "w-[3px] bg-[#27272a] rounded-[2px] shrink-0",
                  `animate-tp-wave-${(i % 5) + 1}`
                )}
                style={{
                  animationDelay: `${(i % 12) * 60}ms`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>
        {formatTime(audioRef.current?.currentTime ?? 0)} / {formatTime(duration)}
      </span>

      <div className="min-w-0 max-w-[200px]">
        <div className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{currentTrack.track_name}</div>
        <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{currentTrack.producer_name}</div>
      </div>

      <div className="flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          {volume > 0 && <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />}
          {volume > 0.5 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
        </svg>
        <input 
          type="range" 
          min="0" 
          max="1" 
          step="0.01" 
          value={volume} 
          onChange={(e) => setVolume(parseFloat(e.target.value))} 
          className="w-20 spotify-slider" 
          style={{
            "--volume-percent": `${volume * 100}%`
          } as React.CSSProperties}
        />
      </div>
    </div>
  );
}


function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const { lang } = useLanguage();
  const { addToast } = useToast();
  const shownToastsRef = useRef<Set<string>>(new Set());

  const labelSlug = typeof window !== "undefined" ? localStorage.getItem("slug") : null;
  const swrKey = labelSlug ? "/api/labels/me/notifications" : null;

  const { data: notifications, mutate } = useSWR<Notification[]>(
    swrKey,
    getNotifications,
    {
      refreshInterval: 15000, // Refresh every 15s
    }
  );

  const unreadCount = notifications ? notifications.filter((n) => !n.read).length : 0;

  // Sync toasts for new unread notifications
  useEffect(() => {
    if (!notifications) return;
    notifications.forEach((n) => {
      if (!n.read && !shownToastsRef.current.has(n.id)) {
        shownToastsRef.current.add(n.id);
        addToast({
          title: n.title,
          description: n.message,
          variant: n.title.toLowerCase().includes("expirada") || n.title.toLowerCase().includes("eliminada") ? "destructive" : "default",
        });
      }
    });
  }, [notifications, addToast]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleOpenToggle = async () => {
    if (!isOpen) {
      setIsOpen(true);
      try {
        await markNotificationsAsRead();
        mutate();
      } catch (err) {
        console.error("Failed to mark notifications as read:", err);
      }
    } else {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleOpenToggle}
        className="relative p-2.5 rounded-full hover:bg-white/5 transition-all cursor-pointer flex items-center justify-center border"
        style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
      >
        <Bell className="w-4 h-4 text-zinc-400 hover:text-white transition-colors" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white leading-none shadow-[0_0_8px_rgba(239,68,68,0.5)]">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2.5 w-80 rounded-xl border p-4 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2"
          style={{
            background: "var(--bg-card)",
            borderColor: "var(--border)",
            boxShadow: "0 12px 30px -10px rgba(0,0,0,0.8)",
          }}
        >
          <div className="flex justify-between items-center mb-3.5 pb-2 border-b" style={{ borderColor: "var(--border)" }}>
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              {lang === "es" ? "Notificaciones" : "Notifications"}
            </span>
            {unreadCount > 0 && (
              <span className="text-[10px] text-emerald-400 font-medium">
                {lang === "es" ? `${unreadCount} nuevas` : `${unreadCount} new`}
              </span>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto space-y-2.5 pr-1" style={{ scrollbarWidth: "thin" }}>
            {!notifications || notifications.length === 0 ? (
              <div className="text-xs text-zinc-500 text-center py-6">
                {lang === "es" ? "No hay notificaciones" : "No notifications"}
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className="p-3 rounded-lg border text-xs transition-all"
                  style={{
                    background: n.read ? "transparent" : "rgba(16,185,129,0.02)",
                    borderColor: n.read ? "var(--border)" : "rgba(16,185,129,0.15)",
                  }}
                >
                  <div className="flex justify-between items-start mb-1 gap-2">
                    <span className="font-semibold text-zinc-100">{n.title}</span>
                    <span className="text-[9px] text-zinc-500 whitespace-nowrap">
                      {new Date(n.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-normal">{n.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}


function DashboardInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { lang, t } = useLanguage();
  const { toggleTheme } = useTheme();
  const [labelName, setLabelName] = useState<string>("");
  const [planInfo, setPlanInfo] = useState<string>("");
  const [plan, setPlan] = useState<string>("free");
  const [subscriptionStatus, setSubscriptionStatus] = useState<string>("active");
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [hqCount, setHqCount] = useState<{ count: number; limit: number } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [monthlyUsed, setMonthlyUsed] = useState<number>(0);
  const [maxTracksMonth, setMaxTracksMonth] = useState<number>(10);
  const [mounted, setMounted] = useState(false);
  const [currentRole, setCurrentRole] = useState<string>("label");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const { queueTracks } = usePlayer();
  const setLabelData = useLabelStore((s) => s.setLabelData);
  const setLabelLoading = useLabelStore((s) => s.setLabelLoading);
  const setLabelError = useLabelStore((s) => s.setLabelError);

  // SWR: label data is fetched once and shared across all dashboard pages.
  // We keep the existing local state for legacy UI bindings and ALSO mirror
  // the response into the Zustand store so non-fetching components (link,
  // config, guide) can read it synchronously without triggering refetch.
  const labelSlug =
    typeof window !== "undefined" ? localStorage.getItem("slug") : null;
  const swrKey = labelSlug ? `/api/labels/${labelSlug}` : null;
  const { data: labelData, error: labelError, isLoading: labelIsLoading } =
    useSWR<LabelConfig>(swrKey);

  useEffect(() => {
    if (!labelData) return;
    setLabelData(labelData);
    setLabelName(labelData.name || labelSlug || "");
    const status = labelData.subscription_status || "active";
    setSubscriptionStatus(status);

    const overridePlan = localStorage.getItem("admin_plan_override");
    if (overridePlan) {
      setPlanInfo(
        overridePlan.charAt(0).toUpperCase() +
          overridePlan.slice(1) +
          " (Override)"
      );
      setPlan(overridePlan);
      localStorage.setItem("plan", overridePlan);
    } else {
      const currentStoredPlan = localStorage.getItem("plan");
      const newPlan = labelData.plan || "free";
      setPlanInfo(newPlan);
      setPlan(newPlan);
      if (currentStoredPlan !== newPlan) {
        localStorage.setItem("plan", newPlan);
        window.dispatchEvent(new Event("plan_updated"));
      }
    }

    setLogoPath(labelData.logo_path || null);
    setMaxTracksMonth(labelData.max_tracks_month || 10);
  }, [labelData, labelSlug, setLabelData]);

  useEffect(() => {
    if (labelError) {
      const msg = labelError instanceof Error ? labelError.message : "Error";
      setLabelError(msg);
      if (labelSlug) setLabelName(labelSlug);
    }
  }, [labelError, labelSlug, setLabelError]);

  useEffect(() => {
    setLabelLoading(labelIsLoading);
  }, [labelIsLoading, setLabelLoading]);

  // Track whether the account is frozen so we can skip loading the audio
  // queue. We resolve this synchronously from the SWR data (no extra fetch).
  const isFrozenFromSWR = !!(labelData && labelData.subscription_status === "frozen");

  useEffect(() => {
    setMounted(true);

    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!labelSlug || !token) {
        router.push("/login");
        return null;
      }
      localStorage.setItem("token", token);
      return token;
    };

    const storedRole = localStorage.getItem("role") || "label";
    setCurrentRole(storedRole);

    // Intercept 401 Unauthorized globally while on dashboard
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      if (typeof args[0] === "string" && args[0].startsWith("/api/")) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          localStorage.setItem("token", session.access_token);
          const options: RequestInit = args[1] || {};
          options.headers = {
            ...options.headers,
            Authorization: `Bearer ${session.access_token}`
          };
          args[1] = options;
        }
      }

      const res = await originalFetch(...args);
      if (res.status === 401) {
        localStorage.removeItem("slug");
        localStorage.removeItem("label_id");
        localStorage.removeItem("plan");
        localStorage.removeItem("token");
        localStorage.removeItem("role");
        localStorage.removeItem("admin_plan_override");
        window.location.href = "/login";
      }
      return res;
    };

    // Load inbox tracks for the global audio player.
    // Wait for SWR to surface the label config so we can skip when frozen.
    const loadPlayerQueue = async () => {
      if (isFrozenFromSWR) return; // Do not load audio queue if frozen
      try {
        const token = await checkAuth();
        if (!token) return;
        const res = await fetch(`/api/submissions?status=inbox&limit=100`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data: PlayerTrack[] = await res.json();
          const withMp3 = data.filter((t) => t.mp3_path);
          queueTracks(withMp3);
        }
      } catch { /* silent */ }
    };

    loadPlayerQueue();

    // If user just completed a payment, re-fetch plan after a short delay
    // to give the webhook time to process
    if (localStorage.getItem("payment_completed") === "true") {
      localStorage.removeItem("payment_completed");

      const checkUpdate = async (delay: number) => {
        setTimeout(async () => {
          try {
            const res = await fetch(`/api/labels/${labelSlug}`);
            if (res.ok) {
              const data = await res.json();
              const newPlan = data.plan || "free";
              const oldPlan = localStorage.getItem("plan") || "free";
              const newStatus = data.subscription_status || "active";

              if ((newPlan !== "free" && newPlan !== oldPlan) || newStatus === "active") {
                console.log(`[Payment] Plan upgraded detected: ${newPlan}`);
                setPlan(newPlan);
                setSubscriptionStatus(newStatus);
                setPlanInfo(newPlan.charAt(0).toUpperCase() + newPlan.slice(1));
                localStorage.setItem("plan", newPlan);
                window.location.reload(); // Reload to apply new plan limits
              } else if (delay < 10000 && newPlan === "free") {
                // If still free after 4s, try one more time after 10s total
                console.log(`[Payment] Plan still free, retrying in 6s...`);
                checkUpdate(6000);
              }
            }
          } catch (err) {
            console.error("[Payment] Error checking plan update:", err);
          }
        }, delay);
      };

      checkUpdate(4000); // Initial check after 4s
    }

    const handlePlanUpdate = () => {
      const newPlan = localStorage.getItem("plan");
      const overridePlan = localStorage.getItem("admin_plan_override");
      if (overridePlan) return;
      if (newPlan && newPlan !== plan) {
        setPlan(newPlan);
        setPlanInfo(newPlan.charAt(0).toUpperCase() + newPlan.slice(1));
      }
    };
    window.addEventListener("plan_updated", handlePlanUpdate);

    const fetchStats = async () => {
      if (!labelSlug) return;
      try {
        const token = await checkAuth();
        if (!token) return;
        const authHeaders: Record<string, string> = { Authorization: `Bearer ${token}` };
        const res = await fetch(`/api/labels/${labelSlug}/stats`, {
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
        const token = await checkAuth();
        if (!token) return;
        const hqHeaders: Record<string, string> = { Authorization: `Bearer ${token}` };
        const res = await fetch(`/api/labels/${labelSlug}/hq-count`, {
          headers: hqHeaders,
        });
        if (res.ok) {
          const data = await res.json();
          setHqCount({ count: data.count, limit: data.limit });
        }
      } catch { /* silent */ }
    };
    if (labelSlug) fetchHqCount();

    return () => {
      window.fetch = originalFetch;
      window.removeEventListener("plan_updated", handlePlanUpdate);
    };
    // We intentionally re-run when frozen status flips so the player queue
    // loads/unloads as the account state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFrozenFromSWR]);

  const role = currentRole;
  const navItems = [
    { href: "/config", label: t("dashboard.nav.config"), icon: Sliders },
    { href: "/link", label: t("dashboard.nav.link"), icon: Link2 },
    { href: "/inbox", label: role === "dj" ? "Promos" : "Demos", icon: Inbox },
    { 
      href: "/emails", 
      label: "Emails", 
      icon: Mail,
      children: [
        { href: "/emails", label: "CRM" },
        { href: "/emails/templates", label: "Templates" },
      ]
    },
    { href: "/guide", label: t("dashboard.nav.guide"), icon: BookOpen },
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
        style={{ width: "200px", background: "var(--bg-card)", borderRight: "1px solid var(--border)" }}
      >
        <div className="px-4 pt-6 pb-4 flex items-center justify-start">
          <Link href="/"><img src="/logo.png" alt="True Peak" className="h-8 w-auto object-contain" /></Link>
        </div>

        <nav className="flex-1 px-2.5 pt-4 space-y-1">
          {navItems.map((item) => {
            // Emails is active for both /emails and /emails/templates
            const isActive = item.href === "/emails" 
              ? pathname.startsWith("/emails")
              : pathname === item.href;
            const isOnSubPage = item.children && isActive && pathname !== item.href;
            const Icon = item.icon;
            
            return (
              <div key={item.href}>
                <Link href={item.href} onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 text-[13px] font-medium px-3 py-2 rounded mb-0.5 border border-transparent",
                    isActive ? "font-semibold" : "hover:border-zinc-600"
                  )}
                  style={{ color: isActive ? "#10b981" : "var(--text-secondary)", background: "transparent" }}>
                  <Icon className={cn("w-4 h-4", isActive ? "text-emerald-500" : "text-zinc-400")} />
                  <span>{item.label}</span>
                </Link>
                
                {/* Sub-navigation items */}
                {item.children && isActive && (
                  <div className="ml-5 mt-1 space-y-0.5">
                    {item.children.map((child, idx) => {
                      const isChildActive = pathname === child.href;
                      const isLast = idx === item.children!.length - 1;
                      const isFirst = idx === 0;
                      const connectorColor = isChildActive ? "#10b981" : "rgba(63,63,70,0.5)";
                      return (
                        <div key={child.href} className="relative pl-4">
                          {/* Vertical segment: full height for non-last, half for last */}
                          <div
                            className="absolute w-px"
                            style={{
                              left: "0",
                              top: "0",
                              height: isLast ? "50%" : "100%",
                              background: connectorColor,
                            }}
                          />
                          {/* Curved corner connecting vertical to horizontal */}
                          <div
                            className="absolute"
                            style={{
                              left: "0",
                              top: "11px",
                              width: "16px",
                              height: "12px",
                              borderLeft: `1.5px solid ${connectorColor}`,
                              borderBottom: `1.5px solid ${connectorColor}`,
                              borderBottomLeftRadius: "8px",
                            }}
                          />
                          <Link
                            href={child.href}
                            onClick={() => setSidebarOpen(false)}
                            className={cn(
                              "block text-[12px] font-medium px-3 py-1.5 rounded border border-transparent",
                              isChildActive ? "font-semibold" : "hover:border-zinc-600"
                            )}
                            style={{ 
                              color: isChildActive ? "#10b981" : "var(--text-muted)",
                              background: "transparent"
                            }}
                          >
                            {child.label}
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {plan === "free" && (
          <div className="px-4 mb-2 space-y-1">
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
                <AlertTriangle className="w-3.5 h-3.5" /> {lang === "es" 
                  ? `Te quedan ${maxTracksMonth - monthlyUsed} ${role === "dj" ? "promos" : "demos"}` 
                  : `You have ${maxTracksMonth - monthlyUsed} ${role === "dj" ? "promos" : "demos"} left`}
              </div>
            ) : null}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono" style={{ background: "rgba(16,185,129,0.06)", color: "var(--text-muted)" }}>
              <Music className="w-3.5 h-3.5" /> {monthlyUsed}/{maxTracksMonth} {role === "dj" ? "promos" : "demos"} {lang === "es" ? "este mes" : "this month"}
            </div>
          </div>
        )}
        {plan === "indie" && (
          <div className="px-4 mb-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono text-emerald-500" style={{ background: "rgba(16,185,129,0.06)" }}>
              <Clock className="w-3.5 h-3.5" /> {lang === "es" ? "HQ guardados por 7 días" : "HQ stored for 7 days"}
            </div>
          </div>
        )}
        {plan === "pro" && (
          <div className="px-4 mb-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono text-emerald-500" style={{ background: "rgba(16,185,129,0.06)" }}>
              <Clock className="w-3.5 h-3.5" /> {lang === "es" ? "HQ guardados por 14 días" : "HQ stored for 14 days"}
            </div>
          </div>
        )}

        {/* Feedback button */}
        <div className="px-4 mb-3 mt-2 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={() => { setFeedbackOpen(true); setFeedbackSent(false); setFeedbackMsg(""); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded text-[12px] font-medium border border-transparent hover:border-zinc-600"
            style={{ color: "var(--text-muted)" }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            Feedback
          </button>
        </div>

        {/* Admin Testing Panel (Localhost or VPS IP) */}
        {mounted && (
          window.location.hostname === "localhost" || 
          window.location.hostname === "127.0.0.1"
        ) && (
          <div className="px-3 mb-3 mt-4 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
            <div className="text-[9px] font-mono uppercase tracking-widest text-emerald-500 mb-2 px-3">🔧 Testing</div>
            <div className="flex gap-2 px-1">
              {/* Plans */}
              <div className="flex-1">
                <div className="text-[9px] font-mono text-muted mb-1">Plan: {plan}</div>
                <div className="flex flex-col gap-1">
                  {["free", "indie", "pro"].map((p) => (
                    <button
                      key={p}
                      onClick={async () => {
                        localStorage.setItem("admin_plan_override", p);
                        localStorage.setItem("plan", p);
                        const slug = localStorage.getItem("slug");
                        try {
                          await fetch(`/api/labels/${slug}/plan`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ plan: p }),
                            credentials: "include"
                          });
                        } catch (err) { console.error("Plan sync failed:", err); }
                        setPlan(p);
                        setPlanInfo(p.charAt(0).toUpperCase() + p.slice(1) + " (Override)");
                        window.location.reload();
                      }}
                      className={cn(
                        "text-[9px] px-2 py-1 rounded font-mono uppercase transition-all text-center",
                        plan === p 
                          ? "bg-emerald-500 text-black font-bold shadow-[0_0_8px_rgba(16,185,129,0.3)]" 
                          : "text-muted hover:bg-white/5 border border-transparent"
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Role */}
              <div className="flex-1">
                <div className="text-[9px] font-mono text-muted mb-1">Rol: {currentRole === "dj" ? "DJ" : "Sello"}</div>
                <div className="flex flex-col gap-1">
                  {(["label", "dj"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={async () => {
                        const slug = localStorage.getItem("slug");
                        try {
                          await fetch(`/api/admin/labels/${slug}/role`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ role: r }),
                          });
                        } catch (err) { console.error("Role sync failed:", err); }
                        localStorage.setItem("role", r);
                        setCurrentRole(r);
                        window.location.reload();
                      }}
                      className={cn(
                        "text-[9px] px-2 py-1 rounded font-mono uppercase transition-all text-center",
                        currentRole === r 
                          ? "bg-cyan-500 text-black font-bold shadow-[0_0_8px_rgba(6,182,212,0.3)]" 
                          : "text-muted hover:bg-white/5 border border-transparent"
                      )}
                    >
                      {r === "label" ? "Sello" : "DJ"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                localStorage.removeItem("admin_plan_override");
                localStorage.removeItem("role");
                window.location.reload();
              }}
              className="text-[9px] px-3 py-1 rounded font-mono uppercase transition-all text-red-400 hover:bg-red-500/10 w-full mt-2"
            >
              Reset
            </button>
          </div>
        )}

        {/* Bottom area: Profile Info + Settings + Logout */}
        <div className="mt-auto px-3 pb-4 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
          {labelName && (
            <div className="mb-3 px-1">
              <div className="flex items-center gap-2.5">
                {logoPath ? (
                  <img
                    src={logoPath.startsWith("http") || logoPath.startsWith("/") ? logoPath : `/logos/${logoPath}`}
                    alt={labelName}
                    className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                    style={{ border: "1px solid var(--border)" }}
                  />
                ) : (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                    style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}
                  >
                    {labelInitial}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{labelName}</div>
                  <div className="text-[9px] text-emerald-400 font-medium mt-0.5">
                    {plan.toLowerCase() === "pro" ? "Plan Pro" : plan.toLowerCase() === "indie" ? "Plan Indie" : "Plan Free"}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-0.5">
            <Link
              href="/settings"
              onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-2.5 text-[13px] px-3.5 py-1.5 rounded border border-transparent hover:border-zinc-600"
              style={{ color: "var(--text-muted)" }}
            >
              <Settings className="w-4 h-4 flex-shrink-0 text-zinc-500" />
              {t("dashboard.nav.settings")}
            </Link>
            <button
              onClick={() => {
                localStorage.removeItem("slug");
                localStorage.removeItem("label_id");
                localStorage.removeItem("plan");
                localStorage.removeItem("token");
                supabase.auth.signOut().catch(() => {});
                router.push("/");
              }}
              className="w-full flex items-center gap-2.5 text-left text-[13px] px-3.5 py-1.5 rounded border border-transparent hover:border-zinc-600"
              style={{ color: "var(--text-muted)" }}
            >
              <LogOut className="w-4 h-4 flex-shrink-0 text-zinc-500" />
              {t("dashboard.logout")}
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 pt-12 md:pt-0 relative" style={{ marginLeft: "0", paddingBottom: "96px" }}>
        <div className="mx-auto max-w-6xl px-3 md:px-6 py-4 md:py-8 md:ml-[200px]">
          {/* Top header row with Notification Bell */}
          <div className="absolute top-4 right-4 md:top-6 md:right-6 z-30">
            <NotificationBell />
          </div>

          {/* Frozen State Banner */}
          {subscriptionStatus === "frozen" && (
            <div
              className="mb-4 px-4 py-4 rounded border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2"
              style={{
                background: "rgba(239, 68, 68, 0.08)",
                borderColor: "rgba(239, 68, 68, 0.3)",
              }}
            >
              <div className="text-sm">
                <span className="font-semibold" style={{ color: "#ef4444" }}>
                  <AlertTriangle className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
                  {lang === "es" ? "Cuenta congelada por impago" : "Account frozen due to unpaid invoice"}
                </span>
                <span className="text-muted block mt-1">
                  {lang === "es" 
                    ? "Tu suscripción ha expirado. El panel se encuentra en modo lectura y el reproductor de demos ha sido desactivado. Actualizá tu método de pago para reactivar." 
                    : "Your subscription has expired. The dashboard is in read-only mode and the demo player has been disabled. Update your payment method to reactivate."}
                </span>
              </div>
              <Link
                href="/settings"
                className="px-4 py-2 rounded text-xs font-bold whitespace-nowrap transition-all hover:opacity-90 shadow-sm"
                style={{ background: "#ef4444", color: "#fff" }}
              >
                {lang === "es" ? "Reactivar cuenta" : "Reactivate account"}
              </Link>
            </div>
          )}

          {/* Upgrade banner for Free users */}
          {plan === "free" && subscriptionStatus !== "frozen" && (
            <div
              className="mb-4 px-4 py-3 rounded border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
              style={{
                background: "rgba(16,185,129,0.06)",
                borderColor: "rgba(16,185,129,0.2)",
              }}
            >
              <div className="text-sm">
                <span className="font-semibold" style={{ color: "#10b981" }}>
                  {lang === "es" ? "Actualizá tu plan" : "Upgrade your plan"}
                </span>
                <span className="text-muted ml-1">
                  {lang === "es" 
                    ? " — Obtené más tracks, emails de CRM y retención de HQ." 
                    : " — Get more tracks, CRM emails, and HQ retention."}
                </span>
              </div>
              <Link
                href="/settings"
                className="px-4 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-all hover:opacity-90"
                style={{ background: "#10b981", color: "#09090b" }}
              >
                {lang === "es" ? "Ver planes" : "View plans"}
              </Link>
            </div>
          )}
          {children}
        </div>
      </main>

      {subscriptionStatus !== "frozen" && <PlayerBar />}

      {/* Feedback Modal */}
      {feedbackOpen && (
        <>
          <div className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setFeedbackOpen(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md mx-4 rounded-xl border p-6" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">
                {lang === "es" ? "Dejanos tu feedback" : "Leave your feedback"}
              </h2>
              <button onClick={() => setFeedbackOpen(false)} className="text-muted hover:text-primary transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            {feedbackSent ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center" style={{ background: "rgba(16,185,129,0.12)" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <p className="text-sm font-medium" style={{ color: "#10b981" }}>
                  {lang === "es" ? "¡Gracias! Tu mensaje fue enviado." : "Thanks! Your message was sent."}
                </p>
              </div>
            ) : (
              <>
                <textarea
                  value={feedbackMsg}
                  onChange={(e) => setFeedbackMsg(e.target.value)}
                  placeholder={lang === "es" ? "Contanos qué pensás, bugs, ideas..." : "Tell us what you think, bugs, ideas..."}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm bg-transparent resize-none focus:outline-none focus:ring-1 focus:ring-emerald-500 mb-4"
                  style={{ borderColor: "var(--border)", minHeight: "120px" }}
                  autoFocus
                />
                <button
                  onClick={() => {
                    if (!feedbackMsg.trim()) return;
                    const phone = "5491135167226";
                    const msg = encodeURIComponent(feedbackMsg.trim());
                    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
                    setFeedbackSent(true);
                    setTimeout(() => { setFeedbackOpen(false); setFeedbackMsg(""); }, 2000);
                  }}
                  disabled={!feedbackMsg.trim()}
                  className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-40"
                  style={{ background: "#25D366", color: "#fff" }}
                >
                  {lang === "es" ? "Enviar por WhatsApp" : "Send via WhatsApp"}
                </button>
                <p className="text-[10px] text-muted text-center mt-2">
                  {lang === "es" ? "También podés escribir a ruffovalen@gmail.com" : "You can also email ruffovalen@gmail.com"}
                </p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SWRProvider>
      <PlayerProvider>
        <ToastProvider>
          <DashboardInner>{children}</DashboardInner>
        </ToastProvider>
      </PlayerProvider>
    </SWRProvider>
  );
}
