"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface MockTrack {
  name: string;
  producer: string;
  bpm: number;
  lufs: number;
  phase: number;
  status: "analyzing" | "approved" | "rejected";
  reason?: string;
}

const MOCK_TRACKS: MockTrack[] = [
  { name: "Midnight Protocol", producer: "Alex Rivera", bpm: 128.4, lufs: -13.2, phase: 0.85, status: "approved" },
  { name: "Bass Drop Vol.3", producer: "DJ Kroma", bpm: 140.2, lufs: -6.5, phase: -0.15, status: "rejected", reason: "Inverted Phase" },
  { name: "Neon Dreams", producer: "Sarah Chen", bpm: 125.0, lufs: -14.1, phase: 0.92, status: "approved" },
  { name: "Subterranean", producer: "Max Frequency", bpm: 130.0, lufs: -13.8, phase: 0.88, status: "approved" },
  { name: "Ethereal Pulse", producer: "Luna Wave", bpm: 122.8, lufs: -15.0, phase: 0.78, status: "approved" },
  { name: "Crystal Method", producer: "Nova Beat", bpm: 110.5, lufs: -12.0, phase: 0.65, status: "rejected", reason: "Out of Tempo" },
];

function SpectrumVisualization({ active, status }: { active: boolean; status: string }) {
  const bars = 40;
  return (
    <div className="flex items-end justify-center gap-0.5 h-20">
      {Array.from({ length: bars }).map((_, i) => (
        <motion.div
          key={i}
          className={cn(
            "w-1 rounded-t",
            status === "approved" && "bg-accent/70",
            status === "rejected" && "bg-red/70",
            status === "analyzing" && "bg-cyan/70"
          )}
          animate={
            active
              ? {
                  height: [4, Math.random() * 60 + 10, 4],
                }
              : { height: 4 }
          }
          transition={{
            duration: 0.6,
            repeat: active ? Infinity : 0,
            repeatType: "reverse",
            delay: i * 0.03,
          }}
        />
      ))}
    </div>
  );
}

function ScanLine({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <motion.div
      className="absolute left-0 right-0 h-0.5 bg-cyan/60 shadow-lg shadow-cyan/20"
      animate={{ top: ["0%", "100%", "0%"] }}
      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
    />
  );
}

export function DemoSimulation() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<"idle" | "analyzing" | "result">("idle");
  const [cycleCount, setCycleCount] = useState(0);

  const currentTrack = MOCK_TRACKS[currentIndex];

  const nextTrack = useCallback(() => {
    setPhase("idle");
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % MOCK_TRACKS.length);
      setCycleCount((c) => c + 1);
      setPhase("analyzing");
    }, 400);
  }, []);

  useEffect(() => {
    // Initial start
    const startTimer = setTimeout(() => {
      setPhase("analyzing");
    }, 800);

    return () => clearTimeout(startTimer);
  }, []);

  useEffect(() => {
    if (phase === "analyzing") {
      const analyzeTimer = setTimeout(() => {
        setPhase("result");
      }, 2500);
      return () => clearTimeout(analyzeTimer);
    }
    if (phase === "result") {
      const resultTimer = setTimeout(() => {
        nextTrack();
      }, 2000);
      return () => clearTimeout(resultTimer);
    }
  }, [phase, nextTrack]);

  return (
    <div className="relative w-full max-w-md mx-auto">
      {/* Main Card */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface p-6">
        {/* Scan line effect */}
        <div className="relative">
          <ScanLine active={phase === "analyzing"} />

          {/* Track Info */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`${currentIndex}-${phase}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
            >
              <div className="mb-4">
                <p className="text-xs font-medium text-muted uppercase tracking-wider">
                  {phase === "analyzing" ? (
                    <span className="text-cyan">● Analizando</span>
                  ) : phase === "result" ? (
                    <span className={currentTrack.status === "approved" ? "text-accent" : "text-red"}>
                      ● {currentTrack.status === "approved" ? "Aprobado" : "Rechazado"}
                    </span>
                  ) : (
                    <span className="text-muted">Esperando</span>
                  )}
                </p>
                <h4 className="mt-1 font-display text-lg font-bold text-foreground">
                  {currentTrack.name}
                </h4>
                <p className="text-sm text-muted">{currentTrack.producer}</p>
              </div>

              {/* Spectrum */}
              <div className="relative mb-4 overflow-hidden rounded-lg bg-surface2/50 py-2">
                <SpectrumVisualization
                  active={phase === "analyzing"}
                  status={phase === "result" ? currentTrack.status : "analyzing"}
                />
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-surface2 p-2 text-center">
                  <p className="text-xs text-muted">BPM</p>
                  <p className={cn(
                    "font-mono text-lg font-bold",
                    phase === "analyzing" ? "text-muted" : "text-foreground"
                  )}>
                    {phase === "analyzing" ? "..." : currentTrack.bpm.toFixed(1)}
                  </p>
                </div>
                <div className="rounded-lg bg-surface2 p-2 text-center">
                  <p className="text-xs text-muted">LUFS</p>
                  <p className={cn(
                    "font-mono text-lg font-bold",
                    phase === "analyzing" ? "text-muted" : "text-foreground"
                  )}>
                    {phase === "analyzing" ? "..." : currentTrack.lufs.toFixed(1)}
                  </p>
                </div>
                <div className="rounded-lg bg-surface2 p-2 text-center">
                  <p className="text-xs text-muted">Phase</p>
                  <p className={cn(
                    "font-mono text-lg font-bold",
                    phase === "analyzing" ? "text-muted" : "text-foreground"
                  )}>
                    {phase === "analyzing" ? "..." : currentTrack.phase.toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Rejection Reason */}
              {phase === "result" && currentTrack.status === "rejected" && currentTrack.reason && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="mt-3 rounded-lg border border-red/30 bg-red/5 px-3 py-2 text-center"
                >
                  <p className="text-xs text-red">
                    Rechazado: {currentTrack.reason}
                  </p>
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Track Counter */}
      <div className="mt-3 flex justify-center gap-1.5">
        {MOCK_TRACKS.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 w-6 rounded-full transition-colors",
              i === currentIndex ? "bg-accent" : "bg-surface2"
            )}
          />
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-muted">
        Track {currentIndex + 1} of {MOCK_TRACKS.length} · Cycle #{cycleCount + 1}
      </p>
    </div>
  );
}
