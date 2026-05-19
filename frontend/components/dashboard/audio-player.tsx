"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";

interface AudioPlayerProps {
  src: string;
  trackTitle: string;
  submissionId: string;
}

export function AudioPlayer({ src, trackTitle, submissionId }: AudioPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !src) return;

    let ws: WaveSurfer | null = null;
    let cancelled = false;

    const init = async () => {
      try {
        setLoading(true);
        setError(null);

        let peaks: number[] | undefined;

        if (submissionId) {
          try {
            const token = localStorage.getItem("token");
            const res = await fetch(`/api/submissions/${submissionId}/peaks`, {
              credentials: "include",
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (res.ok) {
              const data = await res.json();
              peaks = data.peaks;
            }
          } catch {
            // Peaks not available — WaveSurfer will decode audio instead
          }
        }

        if (cancelled) return;

        ws = WaveSurfer.create({
          container: containerRef.current!,
          waveColor: "#27272a",
          progressColor: "#10b981",
          cursorColor: "#10b981",
          cursorWidth: 1,
          height: 48,
          barWidth: 3,
          barGap: 1,
          barRadius: 2,
          normalize: true,
          backend: "WebAudio",
        });

        ws.on("ready", () => {
          if (cancelled) return;
          setDuration(ws!.getDuration());
          setLoading(false);
        });

        ws.on("audioprocess", () => {
          if (cancelled) return;
          setCurrentTime(ws!.getCurrentTime());
        });

        ws.on("play", () => {
          if (cancelled) return;
          setIsPlaying(true);
        });

        ws.on("pause", () => {
          if (cancelled) return;
          setIsPlaying(false);
        });

        ws.on("finish", () => {
          if (cancelled) return;
          setIsPlaying(false);
          setCurrentTime(0);
        });

        ws.on("error", (err) => {
          if (cancelled) return;
          setError("Preview no disponible");
          setLoading(false);
        });

        ws.setVolume(isMuted ? 0 : volume);

        if (peaks && peaks.length > 0) {
          ws.load(src, [Float32Array.from(peaks)]);
        } else {
          ws.load(src);
        }

        wavesurferRef.current = ws;
      } catch {
        if (!cancelled) {
          setError("Error loading audio");
          setLoading(false);
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      if (ws) {
        ws.destroy();
        wavesurferRef.current = null;
      }
    };
  }, [src, submissionId]);

  const togglePlay = useCallback(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
    }
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(newVolume);
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (isMuted) {
      setVolume(volume || 0.8);
      setIsMuted(false);
      wavesurferRef.current?.setVolume(volume || 0.8);
    } else {
      setIsMuted(true);
      wavesurferRef.current?.setVolume(0);
    }
  }, [isMuted, volume]);

  const formatTime = (seconds: number): string => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{trackTitle}</p>
        {loading && (
          <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>Analizando forma de onda...</span>
        )}
        {error && (
          <span className="text-[10px] font-mono" style={{ color: "#ef4444" }}>{error}</span>
        )}
      </div>

      <div ref={containerRef} className="mb-3" />

      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          disabled={loading}
          className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:opacity-90"
          style={{ background: "#10b981", color: "#09090b" }}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
        </button>

        <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={toggleMute} className="hover:opacity-80" style={{ color: "var(--text-muted)" }}>
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="h-1 w-20"
            style={{ accentColor: "#10b981" }}
          />
        </div>
      </div>
    </div>
  );
}
