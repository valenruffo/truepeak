"use client";

import { useState, useEffect, useCallback } from "react";

interface TwoClickDeleteProps {
  onDelete: () => void;
  size?: number;
}

export default function TwoClickDelete({ onDelete, size = 22 }: TwoClickDeleteProps) {
  const [confirming, setConfirming] = useState(false);

  const handleFirstClick = useCallback(() => {
    setConfirming(true);
  }, []);

  // Auto-cancel after 3 seconds
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const handleConfirm = useCallback(() => {
    setConfirming(false);
    onDelete();
  }, [onDelete]);

  if (confirming) {
    return (
      <button
        onClick={handleConfirm}
        className="flex items-center gap-1 px-2 rounded transition-all text-[10px] font-medium animate-in fade-in"
        style={{
          height: size,
          background: "rgba(239,68,68,0.15)",
          color: "#ef4444",
          border: "1px solid rgba(239,68,68,0.3)",
        }}
      >
        <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        Confirmar
      </button>
    );
  }

  return (
    <button
      onClick={handleFirstClick}
      className="flex items-center justify-center rounded transition-colors hover:bg-white/10"
      style={{ width: size, height: size, color: "var(--text-muted)" }}
      title="Eliminar"
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    </button>
  );
}
