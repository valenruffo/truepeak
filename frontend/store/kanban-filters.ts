import { create } from "zustand";

export interface KanbanFiltersState {
  bpmMin: number | null;
  bpmMax: number | null;
  tonalidades: string[];
  fechaInicio: Date | null;
  fechaFin: Date | null;
  fechaLabel: string | null;

  setBpmMin: (min: number | null) => void;
  setBpmMax: (max: number | null) => void;
  setTonalidades: (tonalidades: string[]) => void;
  setFechaInicio: (fecha: Date | null) => void;
  setFechaFin: (fecha: Date | null) => void;
  setFechaLabel: (label: string | null) => void;
  clearFilters: () => void;
}

export const useKanbanFilters = create<KanbanFiltersState>((set) => ({
  bpmMin: null,
  bpmMax: null,
  tonalidades: [],
  fechaInicio: null,
  fechaFin: null,
  fechaLabel: null,

  setBpmMin: (bpmMin) => set({ bpmMin }),
  setBpmMax: (bpmMax) => set({ bpmMax }),
  setTonalidades: (tonalidades) => set({ tonalidades }),
  setFechaInicio: (fechaInicio) => set({ fechaInicio }),
  setFechaFin: (fechaFin) => set({ fechaFin }),
  setFechaLabel: (fechaLabel) => set({ fechaLabel }),
  clearFilters: () =>
    set({
      bpmMin: null,
      bpmMax: null,
      tonalidades: [],
      fechaInicio: null,
      fechaFin: null,
      fechaLabel: null,
    }),
}));

export const filterSubmissions = (
  submissions: any[],
  filters: KanbanFiltersState
) => {
  return submissions.filter((sub) => {
    if (
      filters.bpmMin !== null &&
      (sub.bpm === null || sub.bpm < filters.bpmMin)
    ) {
      return false;
    }
    if (
      filters.bpmMax !== null &&
      (sub.bpm === null || sub.bpm > filters.bpmMax)
    ) {
      return false;
    }

    if (
      filters.tonalidades.length > 0 &&
      (!sub.musical_key || !filters.tonalidades.includes(sub.musical_key))
    ) {
      return false;
    }

    if (filters.fechaInicio || filters.fechaFin) {
      const subDate = new Date(sub.created_at);
      if (filters.fechaInicio && subDate < filters.fechaInicio) return false;

      if (filters.fechaFin) {
        const endOfDay = new Date(filters.fechaFin);
        endOfDay.setHours(23, 59, 59, 999);
        if (subDate > endOfDay) return false;
      }
    }

    return true;
  });
};
