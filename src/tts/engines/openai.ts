import { s16leBytesToFloat } from "../pcm";
import type { EngineStatus, SynthesisRequest, SynthesisResult, TtsEngine, VoiceInfo } from "../types";

export interface OpenAIConfig {
  apiKey?: string;
  model: string;
  instructions?: string;
  /** Base URL; any OpenAI-compatible /v1/audio/speech server works (e.g. a self-hosted Kokoro server). */
  baseUrl: string;
}

const VOICES = ["alloy", "ash", "ballad", "cedar", "coral", "echo", "fable", "marin", "nova", "onyx", "sage", "shimmer", "verse"];

export async function readApiError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    const m = j?.error?.message ?? j?.detail?.message ?? j?.detail ?? j?.message;
    if (m) return `${res.status}: ${typeof m === "string" ? m : JSON.stringify(m)}`;
  } catch {
    /* not JSON */
  }
  return `${res.status} ${res.statusText}`;
}

export class OpenAIEngine implements TtsEngine {
  readonly id = "openai" as const;
  readonly label = "OpenAI TTS (API key)";
  private cfg: () => OpenAIConfig;

  /** gpt-4o-mini-tts ignores `speed`; the player time-stretches instead. */
  get caps() {
    const fixed = /gpt-4o/.test(this.cfg().model);
    return { wordTimings: false, speedRange: (fixed ? [1, 1] : [0.25, 4]) as [number, number], offline: false, maxChars: 4000, concurrency: 2, needsKey: true };
  }

  constructor(cfg: () => OpenAIConfig) {
    this.cfg = cfg;
  }

  modelTag(): string {
    const c = this.cfg();
    return `openai-${c.baseUrl}-${c.model}-${c.instructions ?? ""}`;
  }

  async init(onStatus: (s: EngineStatus) => void): Promise<void> {
    const c = this.cfg();
    if (!c.apiKey && /api\.openai\.com/.test(c.baseUrl)) {
      const msg = "OpenAI API key missing — add it in Settings › Voice & engine.";
      onStatus({ state: "error", error: msg });
      throw new Error(msg);
    }
    onStatus({ state: "ready", device: "cloud" });
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return VOICES.map((v) => ({ id: v, name: v[0].toUpperCase() + v.slice(1), lang: "multi", engine: "openai" as const }));
  }

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const c = this.cfg();
    const body: Record<string, unknown> = { model: c.model, input: req.text, voice: req.voice, response_format: "pcm" };
    if (!/gpt-4o/.test(c.model)) body.speed = req.speed;
    if (c.instructions && /gpt-4o/.test(c.model)) body.instructions = c.instructions;
    const res = await fetch(`${c.baseUrl.replace(/\/$/, "")}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(`OpenAI TTS failed — ${await readApiError(res)}`);
    const buf = await res.arrayBuffer();
    return { pcm: s16leBytesToFloat(buf), sampleRate: 24000, timingSource: "estimated" };
  }

  dispose(): void {}
}
