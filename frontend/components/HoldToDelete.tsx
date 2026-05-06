"use client";

import { useRef, useState, useCallback } from "react";

interface HoldToDeleteProps {
  onDelete: () => void;
  size?: number;
  className?: string;
}

export default function HoldToDelete({ onDelete, size = 24, className = "" }: HoldToDeleteProps) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const DURATION = 1500; // ms to hold

  const startHold = useCallback(() => {
    setHolding(true);
    setProgress(0);
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const pct = Math.min((elapsed / DURATION) * 100, 100);
      setProgress(pct);
      if (pct >= 100) {
        clearInterval(timerRef.current!);
        timerRef.current = null;
        onDelete();
        setHolding(false);
        setProgress(0);
      }
    }, 16); // ~60fps
  }, [onDelete]);

  const cancelHold = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setHolding(false);
    setProgress(0);
  }, []);

  return (
    <button
      onMouseDown={startHold}
      onMouseUp={cancelHold}
      onMouseLeave={cancelHold}
      onTouchStart={startHold}
      onTouchEnd={cancelHold}
      onTouchCancel={cancelHold}
      className={`relative flex items-center justify-center rounded transition-all overflow-hidden ${className}`}
      style={{
        width: holding ? "auto" : size,
        height: size,
        minWidth: size,
        padding: holding ? "0 8px" : "0",
        color: "#ef4444",
        background: holding ? `conic-gradient(rgba(239,68,68,0.3) ${progress * 3.6}deg, transparent 0deg)` : "transparent",
      }}
      title="Mantén para eliminar"
    >
      {holding ? (
        <span className="text-[9px] font-medium whitespace-nowrap text-red-400 animate-pulse">
          Mantén...
        </span>
      ) : (
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      )}
    </button>
  );
}
