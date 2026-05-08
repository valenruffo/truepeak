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
  playTrack: (track: PlayerTrack) => void;
  queueTracks: (tracks: PlayerTrack[]) => void;
  togglePlay: () => void;
  prevTrack: () => void;
  nextTrack: () => void;
  setVolume: (v: number) => void;
  seekTo: (pct: number) => void;
  formatTime: (s: number) => string;
  audioRef: React.RefObject<HTMLAudioElement | null>;
};

const PlayerContext = createContext<PlayerContextType | null>(null);

export function PlayerProvider({ children, initialTracks = [] }: { children: ReactNode; initialTracks?: PlayerTrack[] }) {
  const [tracks, setTracks] = useState<PlayerTrack[]>(initialTracks);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentTrack = tracks[currentIndex] ?? null;
  const hasTracks = tracks.length > 0;

  // Initialize audio
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = volume;
    }
  }, []);

  // Update source when track changes
  useEffect(() => {
    if (!audioRef.current || tracks.length === 0) return;
    const track = tracks[currentIndex];
    if (!track?.id) return;
    audioRef.current.src = `/mp3s/${track.id}.mp3`;
    audioRef.current.load();
    setProgress(0);
    if (isPlaying) {
      audioRef.current.play().catch(() => setIsPlaying(false));
    }
  }, [currentIndex, tracks]);

  // Play/pause
  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.play().catch(() => setIsPlaying(false));
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying]);

  // Volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Time listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => { if (audio.duration) setProgress((audio.currentTime / audio.duration) * 100); };
    const onMeta = () => setDuration(audio.duration);
    const onEnded = () => {
      if (currentIndex < tracks.length - 1) setCurrentIndex((i) => i + 1);
      else { setIsPlaying(false); setProgress(0); }
    };
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnded);
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
    <PlayerContext.Provider value={{ tracks, currentIndex, currentTrack, isPlaying, progress, duration, volume, hasTracks, playTrack, queueTracks, togglePlay, prevTrack, nextTrack, setVolume, seekTo, formatTime, audioRef }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}


