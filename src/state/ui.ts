import { create } from "zustand";
import type { Rect } from "../pdf/types";

export interface UiStore {
  settingsOpen: boolean;
  settingsTab: string;
  exportOpen: boolean;
  helpOpen: boolean;
  /** Manual reading-line position when not playing. */
  manualRuler: { page: number; rect: Rect; lineIndex?: number } | null;
  /**
   * True after the user scrolls or navigates away from the spoken line. Auto-follow stays off
   * until they come back (button, scrolling the line into view, or a playback command).
   */
  followPaused: boolean;
  /** True while the reader sidebar is being resized (document view defers relayout). */
  resizingSidebar: boolean;
}

export const useUi = create<UiStore>()(() => ({
  settingsOpen: false,
  settingsTab: "voice",
  exportOpen: false,
  helpOpen: false,
  manualRuler: null,
  followPaused: false,
  resizingSidebar: false,
}));

export const openSettings = (tab = "voice") => useUi.setState({ settingsOpen: true, settingsTab: tab });

export const pauseFollow = () => {
  if (!useUi.getState().followPaused) useUi.setState({ followPaused: true });
};

export const resumeFollow = () => {
  if (useUi.getState().followPaused) useUi.setState({ followPaused: false });
};
