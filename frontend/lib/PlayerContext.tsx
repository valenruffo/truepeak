"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type PlayerTrack = {
  id: string;
  track_name: string;
  producer_name: string;
  mp3_path: string | null;
};

type PlayerContextType = {
  tracks: PlayerTrack[];
  currentIndex: number;
  currentTrack: PlayerTrack | null;
  isPlaying: boolean;
  setPlaying: (v: boolean) => void;
  duration: number;
  setDuration: (v: number) => void;
  volume: number;
  hasTracks: boolean;
  playTrack: (track: PlayerTrack) => void;
  queueTracks: (tracks: PlayerTrack[]) => void;
  togglePlay: () => void;
  prevTrack: () => void;
  nextTrack: () => void;
  setVolume: (v: number) => void;
  formatTime: (s: number) => string;
};

const PlayerContext = createContext<PlayerContextType | null>(null);

export function PlayerProvider({ children, initialTracks = [] }: { children: ReactNode; initialTracks?: PlayerTrack[] }) {
  const [tracks, setTracks] = useState<PlayerTrack[]>(initialTracks);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);

  const currentTrack = tracks[currentIndex] ?? null;
  const hasTracks = tracks.length > 0;

  const playTrack = useCallback((track: PlayerTrack) => {
    if (!track.mp3_path && !track.id) return;
    setTracks((prev) => {
      const idx = prev.findIndex((t) => t.id === track.id);
      if (idx >= 0) {
        setCurrentIndex(idx);
        return prev;
      }
      const next = [...prev, track];
      setCurrentIndex(next.length - 1);
      return next;
    });
    setIsPlaying(true);
  }, []);

  const queueTracks = useCallback((newTracks: PlayerTrack[]) => {
    setTracks(newTracks);
    if (newTracks.length > 0) setCurrentIndex(0);
  }, []);

  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);
  const prevTrack = useCallback(() => {
    setCurrentIndex((i) => (i > 0 ? i - 1 : tracks.length - 1));
    setIsPlaying(true);
  }, [tracks.length]);
  const nextTrack = useCallback(() => {
    setCurrentIndex((i) => (i < tracks.length - 1 ? i + 1 : 0));
    setIsPlaying(true);
  }, [tracks.length]);
  const setVolume = useCallback((v: number) => setVolumeState(v), []);

  const formatTime = useCallback((s: number) => {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }, []);

  return (
    <PlayerContext.Provider value={{
      tracks, currentIndex, currentTrack, isPlaying, setPlaying: setIsPlaying, duration, setDuration,
      volume, hasTracks, playTrack, queueTracks, togglePlay, prevTrack, nextTrack, setVolume, formatTime
    }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}
