"use client";

import { motion } from "framer-motion";

interface SpectrumBar {
  height: number;
  delay: number;
}

export function SpectrumBars({
  bars = 32,
  className,
}: {
  bars?: number;
  className?: string;
}) {
  const spectrum: SpectrumBar[] = Array.from({ length: bars }, (_, i) => ({
    height: Math.random() * 40 + 10,
    delay: i * 0.05,
  }));

  return (
    <div className={`flex items-end gap-0.5 ${className ?? ""}`}>
      {spectrum.map((bar, i) => (
        <motion.div
          key={i}
          className="w-1 rounded-t bg-accent/80"
          initial={{ height: 4 }}
          animate={{ height: bar.height }}
          transition={{
            duration: 0.8,
            delay: bar.delay,
            repeat: Infinity,
            repeatType: "reverse",
            repeatDelay: Math.random() * 2,
          }}
        />
      ))}
    </div>
  );
}
