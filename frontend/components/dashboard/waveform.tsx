"use client";

import { useEffect, useRef, useCallback, useState } from "react";

interface WaveformProps {
  peaks: number[];
  progress: number;
  height?: number;
  barWidth?: number;
  barGap?: number;
  playedColor?: string;
  unplayedColor?: string;
  onSeek?: (pct: number) => void;
}

export function Waveform({
  peaks,
  progress,
  height = 64,
  barWidth = 1,
  barGap = 0,
  playedColor = "#10b981",
  unplayedColor = "var(--border)",
  onSeek,
}: WaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onSeek || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      onSeek(pct);
    },
    [onSeek]
  );

  if (!peaks || peaks.length === 0) return null;

  const totalBars = Math.min(peaks.length, 1000);
  const step = Math.max(1, Math.floor(peaks.length / totalBars));
  const halfHeight = height / 2;
  const center = halfHeight;

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      className="flex items-center"
      style={{
        width: "100%",
        height: `${height}px`,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {Array.from({ length: totalBars }).map((_, i) => {
        const peakIndex = i * step;
        const barProgress = (i / totalBars) * 100;
        const isPlayed = barProgress <= progress;
        const peak = peaks[peakIndex] || 0;
        const absPeak = Math.abs(peak);
        const barH = Math.max(1, absPeak * (height - 4));

        return (
          <div
            key={i}
            className="flex-shrink-0"
            style={{
              width: `${barWidth}px`,
              height: `${barH}px`,
              background: isPlayed ? playedColor : unplayedColor,
              marginTop: `${center - barH / 2}px`,
              transition: "background 0.15s ease",
            }}
          />
        );
      })}
    </div>
  );
}

// Hook to fetch and cache peaks from the API
export function useWaveformPeaks(submissionId: string | undefined) {
  const [peaks, setPeaks] = useState<number[]>([]);

  useEffect(() => {
    if (!submissionId) return;

    let cancelled = false;

    const fetchPeaks = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`/api/submissions/${submissionId}/peaks`, {
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (data.peaks?.length > 0) {
            setPeaks(data.peaks);
          }
        }
      } catch {
        // Fall back to empty — no waveform shown
      }
    };

    fetchPeaks();
    return () => { cancelled = true; };
  }, [submissionId]);

  return peaks;
}
