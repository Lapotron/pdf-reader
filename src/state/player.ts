import { create } from "zustand";
import type { PlayerState } from "../tts/player";
import type { EngineId, EngineStatus, VoiceInfo } from "../tts/types";

export interface PositionView {
  sentenceId: number;
  srcStart: number;
  srcEnd: number;
  text: string;
  wordIdx: number;
  wordStart: number | null;
  wordEnd: number | null;
  page: number;
}

export interface PlayerStore {
  state: PlayerState;
  engineStatus: EngineStatus;
  activeEngine: EngineId | null;
  position: PositionView | null;
  voices: VoiceInfo[];
  voicesFor: EngineId | null;
  /** Bumped when cloned voices are added/removed, so voice lists reload. */
  voicesRev: number;
  error: string | null;
  notice: string | null;
  sleepUntil: number | null;
  sleepMode: "off" | "time" | "page" | "chapter";
}

export const usePlayer = create<PlayerStore>()(() => ({
  state: "idle",
  engineStatus: { state: "idle" },
  activeEngine: null,
  position: null,
  voices: [],
  voicesFor: null,
  voicesRev: 0,
  error: null,
  notice: null,
  sleepUntil: null,
  sleepMode: "off",
}));
