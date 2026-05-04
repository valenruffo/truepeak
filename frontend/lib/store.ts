import type { StateCreator } from "zustand";

// --- Types ---

export interface SonicSignature {
  bpm_min: number;
  bpm_max: number;
  lufs_target: number;
  lufs_tolerance: number;
  phase_correlation_min: number;
}

export interface Label {
  id: number;
  name: string;
  slug: string;
  sonicSignature: SonicSignature;
}

export interface Submission {
  id: number;
  label_id: number;
  producer_name: string;
  producer_email: string;
  track_title: string;
  message: string | null;
  status: "pending" | "accepted" | "rejected";
  bpm: number | null;
  lufs: number | null;
  true_peak: number | null;
  phase_correlation: number | null;
  duration: number | null;
  mp3_path: string | null;
  created_at: string;
}

export type FilterStatus = "all" | "pending" | "approved" | "rejected";

export interface Filters {
  status: FilterStatus;
}

// --- Store ---

interface AppState {
  currentLabel: Label | null;
  submissions: Submission[];
  filters: Filters;
  setLabel: (label: Label | null) => void;
  setSubmissions: (submissions: Submission[]) => void;
  setFilter: (status: FilterStatus) => void;
  addSubmission: (submission: Submission) => void;
  updateSubmissionStatus: (
    id: number,
    status: "accepted" | "rejected"
  ) => void;
}

export const useStore: StateCreator<AppState> = (set) => ({
  currentLabel: null,
  submissions: [],
  filters: { status: "all" },

  setLabel: (label) => set({ currentLabel: label }),

  setSubmissions: (submissions) => set({ submissions }),

  setFilter: (status) => set({ filters: { status } }),

  addSubmission: (submission) =>
    set((state) => ({
      submissions: [submission, ...state.submissions],
    })),

  updateSubmissionStatus: (id, status) =>
    set((state) => ({
      submissions: state.submissions.map((s) =>
        s.id === id ? { ...s, status } : s
      ),
    })),
});

import { create } from "zustand";

export const appStore = create<AppState>()((...a) => ({
  ...useStore(...a),
}));
