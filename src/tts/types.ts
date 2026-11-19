export type EngineId = "kokoro" | "openai" | "elevenlabs" | "azure" | "webspeech" | "mock";

export interface VoiceInfo {
  id: string;
  name: string;
  lang: string;
  gender?: "f" | "m";
  grade?: string;
  description?: string;
  engine: EngineId;
}

export interface EngineStatus {
  state: "idle" | "downloading" | "loading" | "ready" | "error";
  progress?: { loaded: number; total: number; file?: string };
  device?: string;
  dtype?: string;
  error?: string;
  message?: string;
}

/** Word timing in seconds (at playback rate 1), offsets relative to the request text. */
export interface WordTiming {
  start: number;
  end: number;
  charStart: number;
  charEnd: number;
}

export interface SynthesisRequest {
  text: string;
  voice: string;
  speed: number;
  signal?: AbortSignal;
  /** Lower = more urgent. */
  priority?: number;
}

export interface SynthesisResult {
  pcm: Float32Array;
  sampleRate: number;
  timings?: WordTiming[];
  timingSource: "engine" | "estimated";
}

export interface EngineCaps {
  wordTimings: boolean;
  speedRange: [number, number];
  offline: boolean;
  maxChars: number;
  concurrency: number;
  needsKey: boolean;
}

export interface TtsEngine {
  readonly id: EngineId;
  readonly label: string;
  readonly caps: EngineCaps;
  /** Part of the audio cache key: model + settings that change the audio. */
  modelTag(): string;
  init(onStatus: (s: EngineStatus) => void): Promise<void>;
  listVoices(): Promise<VoiceInfo[]>;
  synthesize(req: SynthesisRequest): Promise<SynthesisResult>;
  dispose(): void;
}

/** Engines that speak directly (no PCM), e.g. Web Speech. They cannot export or cache. */
export interface LiveTtsEngine {
  readonly id: EngineId;
  readonly label: string;
  readonly live: true;
  readonly caps: EngineCaps;
  init(onStatus: (s: EngineStatus) => void): Promise<void>;
  listVoices(): Promise<VoiceInfo[]>;
  speak(
    text: string,
    o: { voice: string; rate: number; pitch: number; volume: number },
    cb: { onWord(charIndex: number, charLength: number): void; onEnd(): void; onError(e: unknown): void },
  ): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  dispose(): void;
}

export type AnyEngine = TtsEngine | LiveTtsEngine;

export const isLive = (e: AnyEngine): e is LiveTtsEngine => (e as LiveTtsEngine).live === true;

export class AbortError extends Error {
  constructor() {
    super("Aborted");
    this.name = "AbortError";
  }
}
