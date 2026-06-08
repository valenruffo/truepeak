"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { Waveform, useWaveformPeaks } from "@/components/dashboard/waveform";

interface AudioPlayerProps {
  src: string;
  trackTitle: string;
  submissionId: string;
}

export function AudioPlayer({ src, trackTitle, submissionId }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const peaks = useWaveformPeaks(submissionId);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hasAudio, setHasAudio] = useState(!!src);

  useEffect(() => {
    if (!src) return;
    const audio = new Audio(src);
    audioRef.current = audio;

    audio.addEventListener("loadedmetadata", () => {
      setDuration(audio.duration);
      setHasAudio(true);
    });
    audio.addEventListener("timeupdate", () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration) setProgress((audio.currentTime / audio.duration) * 100);
    });
    audio.addEventListener("ended", () => {
      setIsPlaying(false);
      setCurrentTime(0);
      setProgress(0);
    });
    audio.addEventListener("error", () => setHasAudio(false));

    audio.volume = volume;

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, [src]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => setHasAudio(false));
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    setIsMuted(v === 0);
    if (audioRef.current) audioRef.current.volume = v;
  }, []);

  const toggleMute = useCallback(() => {
    if (isMuted) {
      setVolume(volume || 0.8);
      setIsMuted(false);
      if (audioRef.current) audioRef.current.volume = volume || 0.8;
    } else {
      setVolume(0);
      setIsMuted(true);
      if (audioRef.current) audioRef.current.volume = 0;
    }
  }, [isMuted, volume]);

  const handleSeek = useCallback((pct: number) => {
    if (audioRef.current && duration) {
      audioRef.current.currentTime = pct * duration;
    }
  }, [duration]);

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
        {!hasAudio && (
          <span className="text-[10px] font-mono" style={{ color: "#ef4444" }}>Preview no disponible</span>
        )}
      </div>

      <div className="mb-3">
        <Waveform
          peaks={peaks}
          progress={progress}
          height={64}
          onSeek={handleSeek}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          disabled={!hasAudio}
          className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:opacity-90"
          style={{ background: hasAudio ? "#10b981" : "var(--border)", color: "#09090b" }}
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
