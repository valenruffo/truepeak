"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/config", label: "Firma sónica" },
  { href: "/link", label: "Link" },
  { href: "/inbox", label: "Demos" },
  { href: "/crm", label: "CRM" },
];

type Track = { id: string; track_name: string; producer_name: string; mp3_path: string | null };

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [labelName, setLabelName] = useState<string>("");
  const [planInfo, setPlanInfo] = useState<string>("");
  const [hqCount, setHqCount] = useState<{ count: number; limit: number } | null>(null);

  // Audio player state
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const slug = localStorage.getItem("slug");
    const token = localStorage.getItem("token");

    const fetchLabel = async () => {
      if (!slug) {
        setLabelName("");
        setPlanInfo("");
        return;
      }

      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/labels/${slug}`);
        if (res.ok) {
          const data = await res.json();
          setLabelName(data.name || slug);
          setPlanInfo(data.plan || "");
        } else {
          setLabelName(slug);
          setPlanInfo("");
        }
      } catch {
        setLabelName(slug);
        setPlanInfo("");
      }
    };
    fetchLabel();

    // Fetch HQ count
    const fetchHqCount = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/labels/${slug}/hq-count`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          setHqCount(data);
        }
      } catch {
        // silently fail
      }
    };
    if (slug) fetchHqCount();

    // Fetch approved tracks with MP3
    const fetchTracks = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/submissions?status=approved`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data: Track[] = await res.json();
          const withMp3 = data.filter((t) => t.mp3_path);
          setTracks(withMp3);
        }
      } catch {
        // No tracks available
      }
    };
    fetchTracks();
  }, []);

  // Initialize audio element
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = volume;
    }
  }, []);

  // Update audio source when current track changes
  useEffect(() => {
    if (!audioRef.current || tracks.length === 0) return;
    const track = tracks[currentIndex];
    if (!track) return;
    audioRef.current.src = `${process.env.NEXT_PUBLIC_API_URL}/mp3s/${track.id}.mp3`;
    audioRef.current.load();
    setProgress(0);
    if (isPlaying) {
      audioRef.current.play().catch(() => setIsPlaying(false));
    }
  }, [currentIndex, tracks]);

  // Play/pause control
  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.play().catch(() => setIsPlaying(false));
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying]);

  // Volume control
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Time update listener
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      if (audio.duration) {
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };
    const onLoadedMetadata = () => setDuration(audio.duration);
    const onEnded = () => {
      if (currentIndex < tracks.length - 1) {
        setCurrentIndex((i) => i + 1);
      } else {
        setIsPlaying(false);
        setProgress(0);
      }
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
    };
  }, [currentIndex, tracks.length]);

  const togglePlay = () => setIsPlaying((p) => !p);
  const prevTrack = () => setCurrentIndex((i) => (i > 0 ? i - 1 : tracks.length - 1));
  const nextTrack = () => setCurrentIndex((i) => (i < tracks.length - 1 ? i + 1 : 0));

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const currentTrack = tracks[currentIndex];
  const hasTracks = tracks.length > 0;

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !audioRef.current.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = pct * audioRef.current.duration;
  };

  return (
    <div className="flex min-h-screen" style={{ background: "#09090b", color: "#fafafa" }}>
      {/* Sidebar */}
      <aside
        className="fixed top-0 left-0 h-full flex flex-col z-40"
        style={{
          width: "240px",
          background: "#111114",
          borderRight: "1px solid #27272a",
        }}
      >
        {/* Logo */}
        <div className="px-5 pt-6 pb-4">
          <Link href="/inbox">
            <img src="/logo.png" alt="True Peak AI" className="h-7 w-auto" />
          </Link>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "block text-sm px-3 py-2 rounded transition-colors mb-0.5",
                  isActive ? "font-medium" : "hover:bg-white/5"
                )}
                style={{
                  color: isActive ? "#10b981" : "#a1a1aa",
                  background: isActive ? "rgba(16,185,129,0.08)" : "transparent",
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* HQ storage counter */}
        {hqCount && (
          <div className="px-3 mb-3">
            <div
              className="px-3 py-1.5 rounded text-xs font-mono"
              style={{
                background: "rgba(16,185,129,0.06)",
                color: hqCount.count >= hqCount.limit ? "#ef4444" : "#71717a",
              }}
            >
              📦 {hqCount.count}/{hqCount.limit} HQ
            </div>
          </div>
        )}

        {/* Label info at bottom */}
        {labelName && (
          <div className="px-5 pb-5">
            <div style={{ borderTop: "1px solid #27272a" }} className="pt-4">
              <div className="text-sm font-medium truncate">{labelName}</div>
              {planInfo && (
                <div className="text-[10px] text-muted mt-0.5">{planInfo}</div>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1" style={{ marginLeft: "240px", paddingBottom: hasTracks ? "64px" : "0" }}>
        <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
      </main>

      {/* Global audio player */}
      {hasTracks && currentTrack && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 flex items-center gap-4 px-4"
          style={{
            height: "64px",
            background: "#111114",
            borderTop: "1px solid #27272a",
            marginLeft: "240px",
          }}
        >
          {/* Prev button */}
          <button
            onClick={prevTrack}
            className="p-1.5 rounded transition-colors hover:bg-white/10"
            title="Anterior"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2">
              <polygon points="19 20 9 12 19 4 19 20" />
              <line x1="5" y1="19" x2="5" y2="5" />
            </svg>
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="p-2 rounded-full transition-colors hover:bg-white/10"
            title={isPlaying ? "Pausar" : "Reproducir"}
          >
            {isPlaying ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#fafafa">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#fafafa">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>

          {/* Next button */}
          <button
            onClick={nextTrack}
            className="p-1.5 rounded transition-colors hover:bg-white/10"
            title="Siguiente"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2">
              <polygon points="5 4 15 12 5 20 5 4" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </button>

          {/* Progress bar */}
          <div
            className="flex-1 h-1.5 rounded-full cursor-pointer group"
            style={{ background: "#27272a" }}
            onClick={handleSeek}
          >
            <div
              className="h-full rounded-full transition-all duration-150 group-hover:h-2"
              style={{ width: `${progress}%`, background: "#10b981" }}
            />
          </div>

          {/* Time */}
          <span className="text-[10px] font-mono text-muted w-16 text-right">
            {audioRef.current ? formatTime(audioRef.current.currentTime) : "0:00"}
          </span>

          {/* Track info */}
          <div className="min-w-0 max-w-[200px]">
            <div className="text-xs font-medium truncate">{currentTrack.track_name}</div>
            <div className="text-[10px] text-muted truncate">{currentTrack.producer_name}</div>
          </div>

          {/* Volume */}
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
              className="w-16 h-1 accent-emerald-500"
            />
          </div>
        </div>
      )}
    </div>
  );
}
