import { create } from "zustand";
import type { Rect } from "../pdf/types";

export interface UiStore {
  settingsOpen: boolean;
  settingsTab: string;
  exportOpen: boolean;
  helpOpen: boolean;
  /** Manual reading-line position when not playing. */
  manualRuler: { page: number; rect: Rect; lineIndex?: number } | null;
  /** Timestamp of the last user-initiated scroll (pauses auto-follow). */
  userScrollAt: number;
  showBackToReading: boolean;
}

export const useUi = create<UiStore>()(() => ({
  settingsOpen: false,
  settingsTab: "voice",
  exportOpen: false,
  helpOpen: false,
  manualRuler: null,
  userScrollAt: 0,
  showBackToReading: false,
}));

export const openSettings = (tab = "voice") => useUi.setState({ settingsOpen: true, settingsTab: tab });
