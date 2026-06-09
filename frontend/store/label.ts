/**
 * Global Zustand store for the active label configuration.
 *
 * The dashboard fetches `/api/labels/{slug}` exactly once (from the layout)
 * and the result is mirrored here so any component (inbox, CRM, link, config)
 * can read the label synchronously without triggering duplicate fetches.
 *
 * SWR handles the network request + caching + dedup. This store just gives
 * us a synchronous, React-friendly accessor for the data SWR has loaded.
 */

import { create } from "zustand";

export interface LabelConfig {
  id?: number;
  name?: string;
  slug?: string;
  plan?: string;
  subscription_status?: string;
  reply_to_email?: string | null;
  owner_email?: string | null;
  logo_path?: string | null;
  max_tracks_month?: number;
  sonic_signature?: any;
  [key: string]: any;
}

interface LabelState {
  labelData: LabelConfig | null;
  labelLoading: boolean;
  labelError: string | null;

  setLabelData: (data: LabelConfig) => void;
  setLabelLoading: (loading: boolean) => void;
  setLabelError: (err: string | null) => void;
  resetLabel: () => void;
}

export const useLabelStore = create<LabelState>((set) => ({
  labelData: null,
  labelLoading: false,
  labelError: null,

  setLabelData: (data) =>
    set({
      labelData: data,
      labelLoading: false,
      labelError: null,
    }),
  setLabelLoading: (loading) => set({ labelLoading: loading }),
  setLabelError: (err) =>
    set({ labelError: err, labelLoading: false }),
  resetLabel: () =>
    set({ labelData: null, labelLoading: false, labelError: null }),
}));

/**
 * Convenience selector — return only the parts of label data we use most
 * often, so components don't re-render on unrelated label updates.
 */
export const selectLabelName = (s: LabelState) => s.labelData?.name ?? "";
export const selectLabelPlan = (s: LabelState) => s.labelData?.plan ?? "free";
export const selectLabelSlug = (s: LabelState) => s.labelData?.slug ?? "";
export const selectSonicSignature = (s: LabelState) =>
  s.labelData?.sonic_signature ?? null;
