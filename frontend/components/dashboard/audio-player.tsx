"use client";

import { useState, useRef, useEffect } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

interface AudioPlayerProps {
  src?: string;
  trackTitle: string;
}

// Generate mock waveform data
function generateWaveform(length: number = 100): number[] {
  return Array.from({ length }, () => Math.random() * 0.8 + 0.2);
}

export function AudioPlayer({ src, trackTitle }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [waveform] = useState(() => generateWaveform(80));
  const [hasAudio, setHasAudio] = useState(!!src);

  useEffect(() => {
    if (src) {
      audioRef.current = new Audio(src);
      const audio = audioRef.current;

      audio.addEventListener("loadedmetadata", () => {
        setDuration(audio.duration);
        setHasAudio(true);
      });
      audio.addEventListener("timeupdate", () => {
        setCurrentTime(audio.currentTime);
      });
      audio.addEventListener("ended", () => {
        setIsPlaying(false);
        setCurrentTime(0);
      });
      audio.addEventListener("error", () => {
        setHasAudio(false);
      });

      audio.volume = volume;

      return () => {
        audio.pause();
        audio.src = "";
      };
    }
  }, [src]);

  function togglePlay() {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => setHasAudio(false));
    }
    setIsPlaying(!isPlaying);
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = percent * duration;
    setCurrentTime(percent * duration);
  }

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
    setIsMuted(newVolume === 0);
  }

  function toggleMute() {
    if (audioRef.current) {
      if (isMuted) {
        audioRef.current.volume = volume || 0.8;
        setIsMuted(false);
      } else {
        audioRef.current.volume = 0;
        setIsMuted(true);
      }
    }
  }

  function formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3">
        <p className="text-sm font-medium text-foreground">{trackTitle}</p>
        {!hasAudio && (
          <p className="text-xs text-muted">Preview not available — pending review.</p>
        )}
      </div>

      {/* Waveform Visualization */}
      <div
        className="mb-3 flex cursor-pointer items-center gap-px"
        onClick={handleSeek}
      >
        {waveform.map((height, i) => {
          const isActive = (i / waveform.length) * 100 <= progress;
          return (
            <div
              key={i}
              className={cn(
                "w-1 rounded-full transition-colors",
                isActive ? "bg-accent" : "bg-surface2"
              )}
              style={{ height: `${height * 24 + 4}px` }}
            />
          );
        })}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          disabled={!hasAudio}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
            hasAudio
              ? "bg-accent text-background hover:bg-accent/90"
              : "bg-surface2 text-muted cursor-not-allowed"
          )}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
        </button>

        <span className="font-mono text-xs text-muted">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={toggleMute} className="text-muted hover:text-foreground">
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="h-1 w-20 accent-accent"
          />
        </div>
      </div>
    </div>
  );
}
