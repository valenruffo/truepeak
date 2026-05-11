import { useState, useCallback, useRef, useEffect } from "react";

interface UseUndoableStateOptions {
  maxHistory?: number;
}

interface UseUndoableStateReturn<T> {
  value: T;
  set: (next: T | ((prev: T) => T)) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reset: () => void;
}

/**
 * useUndoableState — state with undo/redo history for controlled components.
 *
 * Use this when programmatic changes (template selection, presets, etc.)
 * would otherwise break the browser's native undo history.
 *
 * For simple text inputs with no programmatic changes, native browser
 * Ctrl+Z / Cmd+Z already works — no hook needed.
 *
 * Usage:
 *   const { value, set, undo, redo, canUndo, canRedo } = useUndoableState("");
 *   <input value={value} onChange={(e) => set(e.target.value)} />
 */
export function useUndoableState<T>(
  initial: T,
  options: UseUndoableStateOptions = {}
): UseUndoableStateReturn<T> {
  const { maxHistory = 50 } = options;

  const [value, setValue] = useState<T>(initial);
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);
  const [, forceUpdate] = useState(0);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        if (resolved === prev) return prev;
        pastRef.current = [...pastRef.current.slice(-(maxHistory - 1)), prev];
        futureRef.current = [];
        return resolved;
      });
    },
    [maxHistory]
  );

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    const previous = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    setValue((current) => {
      futureRef.current = [...futureRef.current, current];
      return previous;
    });
    forceUpdate((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current[futureRef.current.length - 1];
    futureRef.current = futureRef.current.slice(0, -1);
    setValue((current) => {
      pastRef.current = [...pastRef.current, current];
      return next;
    });
    forceUpdate((n) => n + 1);
  }, []);

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  const reset = useCallback(() => {
    setValue(initial);
    pastRef.current = [];
    futureRef.current = [];
    forceUpdate((n) => n + 1);
  }, [initial]);

  return { value, set, undo, redo, canUndo, canRedo, reset };
}

/**
 * useUndoRedoKey — wires Ctrl+Z / Cmd+Z and Ctrl+Y / Cmd+Y to undo/redo
 * callbacks. Attach to a container or use globally.
 *
 * Usage:
 *   useUndoRedoKey({ onUndo: undo, onRedo: redo });
 */
export function useUndoRedoKey({
  onUndo,
  onRedo,
  enabled = true,
}: {
  onUndo?: () => void;
  onRedo?: () => void;
  enabled?: boolean;
}) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (!mod) return;

      if (e.key === "z" && !e.shiftKey && onUndo) {
        e.preventDefault();
        onUndo();
      } else if ((e.key === "y" || (e.key === "z" && e.shiftKey)) && onRedo) {
        e.preventDefault();
        onRedo();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onUndo, onRedo, enabled]);
}
