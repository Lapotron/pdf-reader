import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_CLEANUP, type CleanupOptions } from "../text/cleanup";
import type { EngineId } from "../tts/types";
import type { KokoroDevice, KokoroDtype } from "../tts/engines/kokoroProtocol";

export type Theme = "light" | "dark" | "sepia" | "system";

export interface RulerSettings {
  enabled: boolean;
  mode: "band" | "underline" | "window";
  color: string;
  opacity: number;
  heightMode: "line" | "fixed";
  heightPx: number;
  padding: number;
  span: "line" | "column" | "page";
  linesAhead: 0 | 1 | 2;
  mask: boolean;
  maskColor: string;
  maskOpacity: number;
  animationMs: number;
  /** When not playing: follow the mouse freely, snap to lines, or stay put. */
  manual: "off" | "mouse" | "mouse-snap";
}

export interface ReadingSettings {
  sentenceStyle: "fill" | "underline" | "off";
  sentenceColor: string;
  wordStyle: "fill" | "underline" | "off";
  wordColor: string;
  followMode: "off" | "keep-visible" | "center-line";
  clickToRead: "double" | "single" | "off";
  pauseSentence: number;
  pauseParagraph: number;
  prefetchSeconds: number;
  trimSilence: boolean;
  normalize: boolean;
  rememberPerDoc: boolean;
  audioCacheMB: number;
}

export interface TtsSettings {
  engine: EngineId;
  voices: Partial<Record<EngineId, string>>;
  speed: number;
  pitch: number;
  volume: number;
  fallback: boolean;
  kokoroDevice: KokoroDevice;
  kokoroDtype: KokoroDtype;
  openaiModel: string;
  openaiBaseUrl: string;
  openaiInstructions: string;
  elevenModel: string;
  elevenStability: number;
  elevenSimilarity: number;
  azureRegion: string;
  previewText: string;
}

export interface AppearanceSettings {
  theme: Theme;
  /** "auto" (follow the app theme) or a page color set id (src/pdf/pageColors.ts). */
  pageColors: string;
  pageImages: "keep" | "duotone";
}

export interface UiSettings {
  sidebarOpen: boolean;
  /** Reader sidebar width in CSS px (desktop). */
  sidebarWidth: number;
  sidebarTab: "library" | "outline" | "thumbnails" | "bookmarks" | "annotations" | "search";
  zoomMode: "fit-width" | "fit-page" | "custom";
  zoom: number;
  debug: boolean;
}

export interface SettingsState {
  appearance: AppearanceSettings;
  reading: ReadingSettings;
  ruler: RulerSettings;
  cleanup: CleanupOptions;
  tts: TtsSettings;
  ui: UiSettings;
  set<K extends keyof Omit<SettingsState, "set" | "reset">>(section: K, patch: Partial<SettingsState[K]>): void;
  reset(section?: keyof Omit<SettingsState, "set" | "reset">): void;
}

const OLD_PREVIEW_TEXT = "Reading aloud makes long documents easier to follow. This is how I sound.";

export const DEFAULT_VOICES: Record<EngineId, string> = {
  kokoro: "af_heart",
  openai: "alloy",
  elevenlabs: "21m00Tcm4TlvDq8ikWAM",
  azure: "en-US-AvaMultilingualNeural",
  webspeech: "",
  mock: "tone-a",
};

export const DEFAULTS = {
  appearance: { theme: "system", pageColors: "auto", pageImages: "keep" } as AppearanceSettings,
  reading: {
    sentenceStyle: "fill",
    sentenceColor: "#fde68a",
    wordStyle: "fill",
    wordColor: "#f59e0b",
    followMode: "keep-visible",
    clickToRead: "double",
    pauseSentence: 0.12,
    pauseParagraph: 0.45,
    prefetchSeconds: 25,
    trimSilence: true,
    normalize: true,
    rememberPerDoc: true,
    audioCacheMB: 300,
  } as ReadingSettings,
  ruler: {
    enabled: true,
    mode: "band",
    color: "#3b82f6",
    opacity: 0.14,
    heightMode: "line",
    heightPx: 28,
    padding: 3,
    span: "column",
    linesAhead: 0,
    mask: false,
    maskColor: "#0f172a",
    maskOpacity: 0.35,
    animationMs: 180,
    manual: "mouse-snap",
  } as RulerSettings,
  cleanup: DEFAULT_CLEANUP,
  tts: {
    engine: "kokoro",
    voices: { ...DEFAULT_VOICES },
    speed: 1,
    pitch: 1,
    volume: 1,
    fallback: true,
    kokoroDevice: "auto",
    kokoroDtype: "auto",
    openaiModel: "gpt-4o-mini-tts",
    openaiBaseUrl: "https://api.openai.com",
    openaiInstructions: "",
    elevenModel: "eleven_multilingual_v2",
    elevenStability: 0.5,
    elevenSimilarity: 0.75,
    azureRegion: "eastus",
    previewText: "Hi! This is how I sound when I read to you.",
  } as TtsSettings,
  ui: { sidebarOpen: true, sidebarWidth: 288, sidebarTab: "outline", zoomMode: "fit-width", zoom: 1, debug: false } as UiSettings,
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...structuredClone(DEFAULTS),
      set: (section, patch) => set((s) => ({ [section]: { ...s[section], ...patch } }) as Partial<SettingsState>),
      reset: (section) =>
        set(() => (section ? ({ [section]: structuredClone(DEFAULTS[section]) } as Partial<SettingsState>) : structuredClone(DEFAULTS))),
    }),
    {
      name: "mega.settings.v1",
      version: 1,
      // Deep-merge sections so new settings get defaults after upgrades.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        const out = { ...current } as SettingsState;
        for (const k of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
          (out as unknown as Record<string, unknown>)[k] = { ...current[k], ...(p[k] ?? {}) };
        }
        out.tts.voices = { ...DEFAULT_VOICES, ...(p.tts?.voices ?? {}) };
        delete (out.appearance as unknown as Record<string, unknown>).pageTint; // replaced by pageColors
        // Shorter sample sentence (faster previews); keep texts the user customized.
        if (out.tts.previewText === OLD_PREVIEW_TEXT) out.tts.previewText = DEFAULTS.tts.previewText;
        return out;
      },
    },
  ),
);

export const getSettings = () => useSettings.getState();
