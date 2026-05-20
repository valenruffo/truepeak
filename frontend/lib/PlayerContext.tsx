"use client";

import { createContext, useContext, useState, useRef, useEffect, useCallback, type ReactNode } from "react";

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
  progress: number;
  duration: number;
  volume: number;
  hasTracks: boolean;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  playTrack: (track: PlayerTrack) => void;
  queueTracks: (tracks: PlayerTrack[]) => void;
  togglePlay: () => void;
  prevTrack: () => void;
  nextTrack: () => void;
  setVolume: (v: number) => void;
  seekTo: (pct: number) => void;
  formatTime: (s: number) => string;
};

const PlayerContext = createContext<PlayerContextType | null>(null);

export function PlayerProvider({ children, initialTracks = [] }: { children: ReactNode; initialTracks?: PlayerTrack[] }) {
  const [tracks, setTracks] = useState<PlayerTrack[]>(initialTracks);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const audioRef = useRef<HTMLAudioElement | null>(
    typeof window !== "undefined" ? new Audio() : null
  );

  const currentTrack = tracks[currentIndex] ?? null;
  const hasTracks = tracks.length > 0;

  useEffect(() => {
    if (audioRef.current) {
      // Apply cubic (logarithmic perception) volume curve with 90% safety headroom
      audioRef.current.volume = Math.pow(volume, 3) * 0.9;
    }
  }, []);

  useEffect(() => {
    if (!audioRef.current || tracks.length === 0) return;
    const track = tracks[currentIndex];
    if (!track?.id) return;

    audioRef.current.src = `/api/submissions/${track.id}/download?type=mp3`;
    audioRef.current.load();
    setProgress(0);

    if (isPlaying) {
      audioRef.current.play().catch(() => setIsPlaying(false));
    }
  }, [currentIndex, tracks]);

  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.play().catch(() => setIsPlaying(false));
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    if (audioRef.current) {
      // Apply cubic (logarithmic perception) volume curve with 90% safety headroom
      audioRef.current.volume = Math.pow(volume, 3) * 0.9;
    }
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => { if (audio.duration) setProgress((audio.currentTime / audio.duration) * 100); };
    const onMeta = () => setDuration(audio.duration);
    const onEnd = () => {
      if (currentIndex < tracks.length - 1) setCurrentIndex((i) => i + 1);
      else { setIsPlaying(false); setProgress(0); }
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnd);
    };
  }, [currentIndex, tracks.length]);

  const playTrack = useCallback((track: PlayerTrack) => {
    if (!track.mp3_path && !track.id) return;
    setTracks((prev) => {
      const idx = prev.findIndex((t) => t.id === track.id);
      if (idx >= 0) {
        setCurrentIndex(idx);
        setIsPlaying(true);
        return prev;
      }
      const next = [...prev, track];
      setCurrentIndex(next.length - 1);
      setIsPlaying(true);
      return next;
    });
  }, []);

  const queueTracks = useCallback((newTracks: PlayerTrack[]) => {
    setTracks(newTracks);
    if (newTracks.length > 0) setCurrentIndex(0);
  }, []);

  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);
  const prevTrack = useCallback(() => setCurrentIndex((i) => (i > 0 ? i - 1 : tracks.length - 1)), [tracks.length]);
  const nextTrack = useCallback(() => setCurrentIndex((i) => (i < tracks.length - 1 ? i + 1 : 0)), [tracks.length]);
  const setVolume = useCallback((v: number) => setVolumeState(v), []);
  const seekTo = useCallback((pct: number) => {
    if (audioRef.current?.duration) audioRef.current.currentTime = pct * audioRef.current.duration;
  }, []);

  const formatTime = useCallback((s: number) => {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }, []);

  return (
    <PlayerContext.Provider value={{ tracks, currentIndex, currentTrack, isPlaying, progress, duration, volume, hasTracks, audioRef, playTrack, queueTracks, togglePlay, prevTrack, nextTrack, setVolume, seekTo, formatTime }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}
