"use client";

import { motion } from "framer-motion";

interface WaveformProps {
  data?: number[];
  className?: string;
}

export function Waveform({ data, className }: WaveformProps) {
  // Generate placeholder waveform if no data provided
  const points = data ?? Array.from({ length: 100 }, () => Math.random());

  return (
    <div className={`flex items-center gap-px ${className ?? ""}`}>
      {points.map((value, i) => (
        <motion.div
          key={i}
          className="w-0.5 rounded-full bg-cyan/60"
          initial={{ scaleY: 0.2 }}
          animate={{ scaleY: Math.max(0.1, value) }}
          transition={{ duration: 0.5, delay: i * 0.01 }}
          style={{ transformOrigin: "center" }}
        />
      ))}
    </div>
  );
}
